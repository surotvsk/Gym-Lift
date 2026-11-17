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
        GymPhase.replaceWithRest(c)
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
        stopChime()
        manager(c).cancel(alarm(c))
        c.stopService(Intent(c, GymRestService::class.java))
        NotificationManagerCompat.from(c).cancel(COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(LONG_COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(ALERT)
    }

    /** Due alarm for a sounding Rest: only the user's exact alarm may start the bounded foreground service that
        makes Android 15+ (target 35+) grant audio focus to a backgrounded app. Returns false when the caller must
        fall back to the notification-only completion path. */
    fun startDueChime(c: Context, token: String?): Boolean {
        if (token == null || token != id(c) || remaining(c) > 0 || !prefs(c).getBoolean("sound", false) || GymPhase.blocksRestAudio(c)) return false
        return try { c.startForegroundService(Intent(c, GymRestService::class.java).putExtra("due", token)); true }
        catch (_: IllegalStateException) { false } // Inexact alarm or restricted background: no exemption.
        catch (_: SecurityException) { false }
    }

    /** done() sa volá presne raz: hneď, alebo keď dohrá zvuk. inService: volá sa zo služby, ktorá hrá zvuk a sama sa zastaví. */
    fun finish(c: Context, token: String?, inService: Boolean = false, done: () -> Unit = {}) {
        if (GymPhase.blocksRestAudio(c)) { done(); return }
        if (token == null || token != id(c) || remaining(c) > 0) { done(); return }
        prefs(c).edit().remove("id").commit() // služba aj alarm smú upozorniť spolu iba raz
        manager(c).cancel(alarm(c))
        if (!inService) c.stopService(Intent(c, GymRestService::class.java))
        NotificationManagerCompat.from(c).cancel(COUNTDOWN)
        NotificationManagerCompat.from(c).cancel(LONG_COUNTDOWN)
        try { NotificationManagerCompat.from(c).notify(ALERT, notification(c, false)) } catch (_: SecurityException) {}
        if (prefs(c).getBoolean("sound", false)) chime(c, done) else done()
    }

    /** Hlasitosť médií (ako hudba / Bluetooth): v slúchadlách, ak sú pripojené, inak reproduktor; ovláda sa
        tlačidlami hlasitosti a hrá aj v režime vibrácií (vlastník 2026-11-10: budík hral do reproduktora
        aj so slúchadlami a nedal sa stíšiť). Bežiacu hudbu na chvíľu stíši (duck), nezastaví ju. */
    fun chime(c: Context, done: () -> Unit) {
        if (GymPhase.blocksRestAudio(c)) { done(); return }
        stopChime()
        var once = false
        val handler = Handler(Looper.getMainLooper())
        val am = c.getSystemService(AudioManager::class.java)
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        var player: MediaPlayer? = null
        var timeout: Runnable? = null
        var focus: AudioFocusRequest? = null
        val end = {
            if (!once) {
                once = true
                timeout?.let { handler.removeCallbacks(it) }
                player?.release(); player = null
                focus?.let { am.abandonAudioFocusRequest(it) }
                stopPlaying = null
                done()
            }
        }
        stopPlaying = end
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs).setOnAudioFocusChangeListener({ change -> if (change < 0) end() }, handler).build()
        focus = request
        try {
            if (am.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { end(); return }
            val media = MediaPlayer()
            player = media
            media.setAudioAttributes(attrs)
            media.setWakeMode(c, PowerManager.PARTIAL_WAKE_LOCK)
            media.setDataSource(c, Uri.parse("android.resource://${c.packageName}/${R.raw.rest_chime}"))
            media.setOnCompletionListener { end() }
            media.setOnErrorListener { _, _, _ -> end(); true }
            media.prepare(); media.start()
            timeout = Runnable { end() }
            handler.postDelayed(timeout, 5000)
        } catch (_: Exception) { end() }
    }
    private var stopPlaying: (() -> Unit)? = null
    internal fun stopChime() { stopPlaying?.invoke() }
}

class GymRestReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra("id")
        // Exact-alarm delivery is the policy exemption that lets the bounded service (and so audio focus) start.
        if (GymRest.startDueChime(context, token)) return
        val pending = goAsync() // proces musí žiť, kým dohrá zvuk
        GymRest.finish(context, token) { pending.finish() }
    }
}

class GymRestService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var wake: PowerManager.WakeLock? = null
    private var startId = 0 // newest command id: completion stops the service only if nothing newer is queued
    private var playing = false // this service owns one finish/chime until its completion runs
    override fun onBind(intent: Intent?) = null
    private fun hold(timeout: Long) {
        wake?.let { if (it.isHeld) it.release() }
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GymLift:rest").apply { acquire(timeout) }
    }
    /** Retires the single active completion; obsolete commands never reach here while one is active. */
    private fun complete() { playing = false; stopSelfResult(startId) }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        this.startId = startId
        val due = intent?.getStringExtra("due")
        val token = GymRest.id(this)
        val left = GymRest.remaining(this)
        // startForegroundService() must always be answered with startForeground(), even if the Rest is already gone.
        val note = GymRest.notification(this, true)
        if (Build.VERSION.SDK_INT >= 34) startForeground(GymRest.COUNTDOWN, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        else startForeground(GymRest.COUNTDOWN, note)
        // A completion is already finishing (e.g. the countdown fired just before the due alarm's command): an obsolete
        // command must not stop the service under active playback; the completion stops it using the newest id.
        if (playing) return START_NOT_STICKY
        handler.removeCallbacksAndMessages(null)
        if (due != null) {
            // Bounded to one chime (5 s playback timeout): never a second countdown window for a long Rest.
            hold(10_000)
            playing = true
            GymRest.finish(this, due, true) { complete() }
            return START_NOT_STICKY
        }
        if (token == null || left > GymRest.SHORT_LIMIT) { stopSelf(); return START_NOT_STICKY }
        hold(GymRest.SHORT_LIMIT + 2000)
        handler.postDelayed({ playing = true; GymRest.finish(this, token, true) { complete() } }, left.coerceAtLeast(1))
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int) { stopSelf() }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (playing) { playing = false; GymRest.stopChime() } // release player/focus if the OS ends the service first
        wake?.let { if (it.isHeld) it.release() }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
