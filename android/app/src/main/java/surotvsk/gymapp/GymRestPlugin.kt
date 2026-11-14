package surotvsk.gymapp

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.*
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin

/** Časovač je iba v zariadení; identita a koniec chránia pred starým alebo dvojitým alarmom. */
@CapacitorPlugin(name = "GymRest")
class GymRestPlugin : Plugin() {
    @PluginMethod
    fun schedule(call: PluginCall) {
        val id = call.getString("id")
        val end = (call.data.opt("endAt") as? Number)?.toDouble() // JSON čas v ms je Long, getDouble ho neprijíma
        if (id.isNullOrBlank() || end == null || !end.isFinite() || end <= System.currentTimeMillis() || end - System.currentTimeMillis() > 86_400_000) {
            call.reject("Invalid rest deadline"); return
        }
        activity.runOnUiThread {
            try {
                val exact = GymRest.schedule(context, id, end.toLong(), call.getString("title") ?: "Gym-Lift",
                    call.getString("body") ?: "", call.getBoolean("sound", false) ?: false)
                call.resolve(JSObject().put("exact", exact).put("notifications", GymRest.notifications(context, call.getBoolean("sound", false) ?: false)))
            } catch (e: Exception) { GymRest.cancel(context); call.reject("Rest alarm unavailable", e) }
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) = activity.runOnUiThread { GymRest.cancel(context); call.resolve() }

    @PluginMethod
    fun finish(call: PluginCall) = activity.runOnUiThread { GymRest.finish(context, call.getString("id")); call.resolve() }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(JSObject().put("notifications", GymRest.notifications(context, call.getBoolean("sound", false) ?: false)))
    }

    @PluginMethod
    fun requestExact(call: PluginCall) {
        activity.runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= 31 && !GymRest.exact(context)) {
                    activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName)))
                }
                call.resolve()
            } catch (e: Exception) { call.reject("Alarm settings unavailable", e) }
        }
    }
}

internal object GymRest {
    const val COUNTDOWN = 6201
    const val ALERT = 6202
    const val LONG_COUNTDOWN = 6203 // zánik starej služby nesmie odstrániť nový dlhý odpočet
    const val SHORT_LIMIT = 170_000L // rezerva pred trojminútovým limitom shortService
    private fun prefs(c: Context) = c.getSharedPreferences("gymquest_native_rest", Context.MODE_PRIVATE)
    private fun manager(c: Context) = c.getSystemService(AlarmManager::class.java)
    fun exact(c: Context) = Build.VERSION.SDK_INT < 31 || manager(c).canScheduleExactAlarms()
    fun notifications(c: Context, sound: Boolean): Boolean {
        // So zvukom upozorní chime() aj bez povolených notifikácií, web gong by zaznel dvakrát.
        if (sound) return true
        val channel = c.getSystemService(NotificationManager::class.java).getNotificationChannel(if (sound) "rest-alarm" else "rest-silent")
        return NotificationManagerCompat.from(c).areNotificationsEnabled() && channel?.importance != NotificationManager.IMPORTANCE_NONE
    }
    fun id(c: Context): String? = prefs(c).getString("id", null)
    fun remaining(c: Context) = prefs(c).getLong("due", 0) - SystemClock.elapsedRealtime()
    private fun alarm(c: Context, id: String = "") = PendingIntent.getBroadcast(c, COUNTDOWN,
        Intent(c, GymRestReceiver::class.java).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun channels(c: Context, title: String) {
        val nm = c.getSystemService(NotificationManager::class.java)
        // Zvuk hrá chime() na hlasitosti budíka (ako časovač v Hodinách); kanál iba vibruje.
        nm.deleteNotificationChannel("rest-alert") // starý kanál so zvukom notifikácie (v103–v105)
        val sound = NotificationChannel("rest-alarm", title, NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null)
            enableVibration(true)
        }
        val silent = NotificationChannel("rest-silent", title, NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null); enableVibration(false) }
        val countdown = NotificationChannel("rest-countdown", title, NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) }
        nm.createNotificationChannels(listOf(sound, silent, countdown))
    }

    fun notification(c: Context, countdown: Boolean): Notification {
        val p = prefs(c)
        val open = PendingIntent.getActivity(c, COUNTDOWN, Intent(c, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val channel = if (countdown) "rest-countdown" else if (p.getBoolean("sound", false)) "rest-alarm" else "rest-silent"
        return NotificationCompat.Builder(c, channel).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(p.getString("title", "Gym-Lift"))
            .setContentText(if (countdown) null else p.getString("body", ""))
            .setContentIntent(open).setOngoing(countdown).setAutoCancel(!countdown)
            .setCategory(if (countdown) NotificationCompat.CATEGORY_PROGRESS else NotificationCompat.CATEGORY_ALARM)
            .setPriority(if (countdown) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
            .setWhen(System.currentTimeMillis() + remaining(c).coerceAtLeast(0))
            .setUsesChronometer(countdown).setChronometerCountDown(countdown).setOnlyAlertOnce(countdown).build()
    }

    fun schedule(c: Context, token: String, end: Long, title: String, body: String, sound: Boolean): Boolean {
        // Obnovenie vždy plánuje nanovo: elapsedRealtime z minulého bootu už neplatí.
        cancel(c)
        channels(c, title)
        val left = (end - System.currentTimeMillis()).coerceAtLeast(1)
        val due = SystemClock.elapsedRealtime() + left
        var precise = exact(c)
        prefs(c).edit().putString("id", token).putLong("due", due).putString("title", title)
            .putString("body", body).putBoolean("sound", sound).putBoolean("exact", precise).commit()
        val pending = alarm(c, token)
        try {
            if (precise) manager(c).setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, due, pending)
            else manager(c).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, due, pending)
        } catch (_: SecurityException) {
            precise = false
            prefs(c).edit().putBoolean("exact", false).commit()
            manager(c).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, due, pending)
        }
        if (left <= SHORT_LIMIT) {
            try { c.startForegroundService(Intent(c, GymRestService::class.java)) }
            catch (_: IllegalStateException) { /* Pozadie: alarm ostáva naplánovaný. */ }
            catch (_: SecurityException) { /* Systém nepovolil službu; ostáva alarm. */ }
        } else {
            try { NotificationManagerCompat.from(c).notify(LONG_COUNTDOWN, notification(c, true)) } catch (_: SecurityException) {}
        }
        return precise
    }

    fun cancel(c: Context) {
        prefs(c).edit().remove("id").commit()
        playing?.let { stop(it) }
        manager(c).cancel(alarm(c))
        c.stopService(Intent(c, GymRestService::class.java))
        NotificationManagerCompat.from(c).cancel(COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(LONG_COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(ALERT)
    }

    /** done() sa volá presne raz: hneď, alebo keď dohrá zvuk. */
    fun finish(c: Context, token: String?, done: () -> Unit = {}) {
        if (token == null || token != id(c) || remaining(c) > 0) { done(); return }
        prefs(c).edit().remove("id").commit() // služba aj alarm smú upozorniť spolu iba raz
        manager(c).cancel(alarm(c))
        c.stopService(Intent(c, GymRestService::class.java))
        NotificationManagerCompat.from(c).cancel(COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(LONG_COUNTDOWN)
        try { NotificationManagerCompat.from(c).notify(ALERT, notification(c, false)) } catch (_: SecurityException) {}
        if (prefs(c).getBoolean("sound", false)) chime(c, done) else done()
    }

    /** Hlasitosť médií (ako hudba / Bluetooth): v slúchadlách, ak sú pripojené, inak reproduktor; ovláda sa
        tlačidlami hlasitosti a hrá aj v režime vibrácií (vlastník 2026-11-10: budík hral do reproduktora
        aj so slúchadlami a nedal sa stíšiť). Bežiacu hudbu na chvíľu stíši (duck), nezastaví ju. */
    fun chime(c: Context, done: () -> Unit) {
        var once = false
        val am = c.getSystemService(AudioManager::class.java)
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val focus = if (Build.VERSION.SDK_INT >= 26) AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs).build() else null
        val end = { if (!once) { once = true; if (focus != null) am.abandonAudioFocusRequest(focus); done() } }
        if (focus != null) am.requestAudioFocus(focus)
        playing?.release() // nový koniec pauzy nahradí ešte znejúci starý
        try {
            val player = MediaPlayer()
            playing = player // silná referencia: GC by inak zvuk utíšil
            player.setAudioAttributes(attrs)
            player.setWakeMode(c, PowerManager.PARTIAL_WAKE_LOCK) // obrazovka je zhasnutá
            player.setDataSource(c, Uri.parse("android.resource://${c.packageName}/${R.raw.rest_chime}"))
            player.setOnCompletionListener { stop(it); end() }
            player.setOnErrorListener { mp, _, _ -> stop(mp); end(); true }
            player.prepare()
            player.start()
            Handler(Looper.getMainLooper()).postDelayed({ end() }, 5000) // poistka pre goAsync
        } catch (_: Exception) { playing?.let { stop(it) }; end() }
    }
    private var playing: MediaPlayer? = null
    private fun stop(p: MediaPlayer) { p.release(); if (playing === p) playing = null }
}

class GymRestReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync() // proces musí žiť, kým dohrá zvuk
        GymRest.finish(context, intent.getStringExtra("id")) { pending.finish() }
    }
}

class GymRestService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var wake: PowerManager.WakeLock? = null
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val token = GymRest.id(this)
        val left = GymRest.remaining(this)
        if (token == null || left > GymRest.SHORT_LIMIT) { stopSelf(); return START_NOT_STICKY }
        val note = GymRest.notification(this, true)
        if (Build.VERSION.SDK_INT >= 34) startForeground(GymRest.COUNTDOWN, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        else startForeground(GymRest.COUNTDOWN, note)
        handler.removeCallbacksAndMessages(null)
        wake?.let { if (it.isHeld) it.release() }
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GymLift:rest").apply {
            acquire(GymRest.SHORT_LIMIT + 2000)
        }
        handler.postDelayed({ GymRest.finish(this, token) { stopSelf() } }, left.coerceAtLeast(1))
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int) { stopSelf() }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        wake?.let { if (it.isHeld) it.release() }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
