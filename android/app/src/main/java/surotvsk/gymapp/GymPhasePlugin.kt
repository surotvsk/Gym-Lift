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
import org.json.JSONObject
import java.lang.ref.WeakReference

@CapacitorPlugin(name = "GymPhase")
class GymPhasePlugin : Plugin() {
    override fun load() { GymPhase.plugin = WeakReference(this) }
    override fun handleOnDestroy() {
        if (GymPhase.plugin?.get() === this) GymPhase.plugin = null
        super.handleOnDestroy()
    }
    internal fun state(snapshot: JSObject) { notifyListeners("state", snapshot) }
    private fun visible() = !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()
    private fun command(call: PluginCall, block: () -> Unit) {
        activity.runOnUiThread {
            try { block() }
            catch (e: PhaseError) { call.reject(e.message, e.code) }
            catch (e: Exception) { call.reject("Native phase operation failed", "NATIVE_ERROR", e) }
        }
    }
    @PluginMethod fun capabilities(call: PluginCall) = command(call) { call.resolve(GymPhase.capabilities(context)) }
    @PluginMethod fun openBatterySettings(call: PluginCall) = command(call) {
        if (!visible()) throw PhaseError("NOT_VISIBLE", "Open battery settings from the visible app")
        try {
            activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            call.resolve(JSObject().put("opened", true))
        } catch (_: Exception) { throw PhaseError("SETTINGS_UNAVAILABLE", "Android battery settings unavailable") }
    }
    @PluginMethod fun start(call: PluginCall) = command(call) {
        if (!visible()) throw PhaseError("NOT_VISIBLE", "Start the phase from the visible app")
        GymPhase.start(context, PhaseConfig.from(call), call)
    }
    @PluginMethod fun pause(call: PluginCall) = command(call) { call.resolve(GymPhase.command(context, call, "pause")) }
    @PluginMethod fun resume(call: PluginCall) = command(call) {
        if (!visible()) throw PhaseError("NOT_VISIBLE", "Resume the phase from the visible app")
        GymPhase.resume(context, call)
    }
    @PluginMethod fun stop(call: PluginCall) = command(call) { call.resolve(GymPhase.command(context, call, "stop")) }
    @PluginMethod fun setSound(call: PluginCall) = command(call) { call.resolve(GymPhase.command(context, call, "sound")) }
    @PluginMethod fun status(call: PluginCall) = command(call) { call.resolve(GymPhase.status(context)) }
}

internal class PhaseError(val code: String, message: String) : Exception(message)

internal data class PhaseConfig(
    val runId: String, val ownerId: String, val phase: String,
    val workMs: Long, val restMs: Long, val rounds: Int, val sound: Boolean,
    val title: String, val workLabel: String, val restLabel: String, val doneLabel: String
) {
    fun json() = JSONObject().put("runId", runId).put("ownerId", ownerId).put("phase", phase)
        .put("workMs", workMs).put("restMs", restMs).put("rounds", rounds).put("sound", sound)
        .put("title", title).put("workLabel", workLabel).put("restLabel", restLabel).put("doneLabel", doneLabel)
    companion object {
        fun from(call: PluginCall): PhaseConfig {
            fun text(key: String, fallback: String? = null): String {
                val value = call.data.opt(key)
                if (value == null && fallback != null) return fallback
                val limit = when (key) { "runId" -> 200; "ownerId" -> 500; else -> 1024 }
                if (value !is String || value.isBlank() || value.length > limit) throw PhaseError("INVALID_ARGUMENT", "Invalid $key")
                return value
            }
            fun integer(key: String): Long {
                val n = (call.data.opt(key) as? Number)?.toDouble()
                    ?: throw PhaseError("INVALID_ARGUMENT", "Invalid $key")
                if (!n.isFinite() || n % 1.0 != 0.0 || n < 0 || n > 86_400_000) throw PhaseError("INVALID_ARGUMENT", "Invalid $key")
                return n.toLong()
            }
            val phase = text("phase")
            if (phase != "warmup" && phase != "stretching") throw PhaseError("INVALID_ARGUMENT", "Invalid phase")
            val work = integer("workMs"); val rest = integer("restMs"); val rounds = integer("rounds").toInt()
            try { PhaseSequence(work, rest, rounds) } catch (_: IllegalArgumentException) { throw PhaseError("INVALID_ARGUMENT", "Invalid phase duration or rounds") }
            val sound = call.data.opt("sound") as? Boolean ?: throw PhaseError("INVALID_ARGUMENT", "Invalid sound")
            return PhaseConfig(text("runId"), text("ownerId"), phase, work, rest, rounds, sound,
                text("title", "Gym-Lift"), text("workLabel", "Work"), text("restLabel", "Rest"), text("doneLabel", "Done"))
        }
        fun restore(j: JSONObject) = PhaseConfig(j.getString("runId"), j.getString("ownerId"), j.getString("phase"),
            j.getLong("workMs"), j.getLong("restMs"), j.getInt("rounds"), j.getBoolean("sound"),
            j.getString("title"), j.getString("workLabel"), j.getString("restLabel"), j.getString("doneLabel"))
    }
}

/** All entry points run on Android's main looper, including Rest arbitration and service actions. */
internal object GymPhase {
    const val NOTE = 6211
    const val CHANNEL = "phase-countdown"
    private const val AUDIO_GRACE = 6_000L
    private val handler = Handler(Looper.getMainLooper())
    var plugin: WeakReference<GymPhasePlugin>? = null
    private var loaded = false
    private var config: PhaseConfig? = null
    private var initialConfig: PhaseConfig? = null
    private var sequence: PhaseSequence? = null
    private var revision = 0L
    private var boot = -1
    private var savedAt = 0L
    private var audioError: String? = null
    private var finalAudio = false
    private var service: GymPhaseService? = null
    private data class Pending(val runId: String, val call: PluginCall, val timeout: Runnable)
    private var pending: Pending? = null
    private fun prefs(c: Context) = c.getSharedPreferences("gymquest_native_phase", Context.MODE_PRIVATE)
    private fun boot(c: Context) = Settings.Global.getInt(c.contentResolver, Settings.Global.BOOT_COUNT, -1)
    private fun now() = SystemClock.elapsedRealtime()
    private fun nullable(value: Any?) = value ?: JSONObject.NULL
    private fun checkThread() = check(Looper.myLooper() == Looper.getMainLooper())

    private fun load(c: Context) {
        checkThread()
        if (loaded) return
        loaded = true
        val raw = prefs(c).getString("state", null) ?: return
        try {
            val j = JSONObject(raw)
            config = PhaseConfig.restore(j.getJSONObject("config"))
            initialConfig = PhaseConfig.restore(j.getJSONObject("initialConfig"))
            val cfg = config!!
            sequence = PhaseSequence(cfg.workMs, cfg.restMs, cfg.rounds).apply {
                segmentIndex = j.getInt("segmentIndex")
                require(segmentIndex in 0 until segmentCount)
                status = j.getString("status")
                require(status in listOf("running", "paused", "stopped", "completed", "interrupted"))
                deadline = j.getLong("deadline")
                remaining = j.getLong("remaining")
                require(remaining in 0L..duration(segmentIndex))
                lastTransition = j.getInt("lastTransition")
                interruptedReason = if (j.isNull("interruptedReason")) null else j.getString("interruptedReason")
            }
            revision = j.getLong("revision")
            boot = j.getInt("boot")
            savedAt = j.getLong("savedAt")
            audioError = if (j.isNull("audioError")) null else j.getString("audioError")
            if ((sequence!!.status == "running" || sequence!!.status == "paused") && boot != boot(c)) {
                sequence!!.interrupt("reboot"); revision++; persist(c)
            }
        } catch (_: Exception) {
            config = null; initialConfig = null; sequence = null
            // Never reconstruct a run from incomplete or malformed persistence.
            prefs(c).edit().remove("state").commit()
        }
    }

    private fun persist(c: Context) {
        val cfg = config ?: return
        val seq = sequence ?: return
        savedAt = System.currentTimeMillis()
        val j = JSONObject().put("v", 1).put("config", cfg.json()).put("initialConfig", initialConfig!!.json())
            .put("revision", revision).put("boot", boot).put("savedAt", savedAt)
            .put("status", seq.status).put("segmentIndex", seq.segmentIndex).put("deadline", seq.deadline)
            .put("remaining", seq.remaining).put("lastTransition", seq.lastTransition)
            .put("interruptedReason", nullable(seq.interruptedReason)).put("audioError", nullable(audioError))
        if (!prefs(c).edit().putString("state", j.toString()).commit()) throw PhaseError("STORAGE_FAILED", "Could not save phase timer")
    }
    private fun snapshot(): JSObject {
        val cfg = config ?: return JSObject()
        val seq = sequence ?: return JSObject()
        val sample = System.currentTimeMillis()
        val left = seq.left(now())
        return JSObject().put("v", 1).put("ownerId", cfg.ownerId).put("runId", cfg.runId).put("phase", cfg.phase)
            .put("revision", revision).put("status", seq.status).put("segmentIndex", seq.segmentIndex)
            .put("round", seq.round).put("stage", nullable(seq.stage)).put("rounds", cfg.rounds)
            .put("remainingMs", left).put("stageEndAt", if (seq.status == "running") sample + left else 0L)
            .put("sampledAt", sample).put("lastTransition", seq.lastTransition)
            .put("interruptedReason", nullable(seq.interruptedReason)).put("nativeOwnsSound", seq.status == "running" || finalAudio)
            .put("audioError", nullable(audioError)).put("sound", cfg.sound)
    }
    private fun emit() { plugin?.get()?.state(snapshot()) }
    private fun commit(c: Context) {
        revision++
        try { persist(c) }
        catch (e: PhaseError) {
            sequence?.interrupt("storage_failed"); finalAudio = false
            service?.releaseTiming(); service?.finishService()
            cancelPending("STORAGE_FAILED", "Could not save phase timer")
            c.stopService(Intent(c, GymPhaseService::class.java))
            emit()
            throw e
        }
        emit()
    }
    private fun userStopped(c: Context): Boolean {
        if (Build.VERSION.SDK_INT < 30) return false
        return try {
            c.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(null, 0, 4)
                .any { it.timestamp >= savedAt && it.reason == ApplicationExitInfo.REASON_USER_REQUESTED }
        } catch (_: Exception) { false }
    }
    private fun reconcile(c: Context) {
        load(c)
        val seq = sequence ?: return
        if (seq.status == "running" && service == null && pending == null) {
            seq.interrupt(if (userStopped(c)) "user_stopped" else "service_missing")
            commit(c)
        } else if (seq.status == "running" && service != null && pending == null) advance(c)
    }
    fun status(c: Context): JSObject { reconcile(c); return snapshot() }
    fun capabilities(c: Context): JSObject {
        channels(c)
        val power = c.getSystemService(PowerManager::class.java)
        val nm = c.getSystemService(NotificationManager::class.java)
        return JSObject().put("native", true)
            .put("notificationsAllowed", NotificationManagerCompat.from(c).areNotificationsEnabled() && nm.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
            .put("batteryOptimized", !power.isIgnoringBatteryOptimizations(c.packageName))
            .put("backgroundRestricted", Build.VERSION.SDK_INT >= 28 && c.getSystemService(ActivityManager::class.java).isBackgroundRestricted)
            .put("serviceType", "specialUse")
    }
    fun start(c: Context, cfg: PhaseConfig, call: PluginCall) {
        reconcile(c)
        if (config?.runId == cfg.runId) {
            if (initialConfig != cfg) throw PhaseError("RUN_CONFLICT", "Run ID already used with different parameters")
            if (pending != null) throw PhaseError("INVALID_STATE", "Phase start is still pending; reconcile status")
            call.resolve(snapshot()); return
        }
        cancelPending("START_CANCELLED", "Phase replaced before startup completed")
        service?.releaseTiming()
        GymRest.cancel(c) // Internal Rest cancellation never cancels a phase.
        config = cfg; initialConfig = cfg
        sequence = PhaseSequence(cfg.workMs, cfg.restMs, cfg.rounds).apply { deadline = now() + cfg.workMs }
        boot = boot(c); audioError = null; finalAudio = false
        try { revision++; persist(c); begin(c, call) }
        catch (e: Exception) {
            val hadPending = pending != null
            failStart(c, e)
            if (!hadPending) call.reject(e.message ?: "Could not persist phase", if (e is PhaseError) e.code else "FGS_START_FAILED")
        }
    }
    private fun begin(c: Context, call: PluginCall, resume: Boolean = false) {
        val id = config!!.runId
        val timeout = Runnable { if (pending?.runId == id) failStart(c, PhaseError("FGS_START_FAILED", "Foreground startup timed out")) }
        pending = Pending(id, call, timeout)
        handler.postDelayed(timeout, 8_000)
        c.startForegroundService(Intent(c, GymPhaseService::class.java).putExtra("runId", id).putExtra("resume", resume))
    }
    private fun cancelPending(code: String, message: String) {
        pending?.let { handler.removeCallbacks(it.timeout); it.call.reject(message, code) }
        pending = null
    }
    private fun failStart(c: Context, e: Exception) {
        sequence?.interrupt("startup_failed"); revision++
        try { persist(c) } catch (_: Exception) {}
        finalAudio = false
        service?.releaseTiming(); service?.finishService()
        c.stopService(Intent(c, GymPhaseService::class.java))
        cancelPending(if (e is PhaseError) e.code else "FGS_START_FAILED", e.message ?: "Foreground startup failed")
        emit()
    }
    private fun expected(c: Context, runId: String?, expected: Long?, terminalStop: Boolean = false): PhaseSequence {
        reconcile(c)
        val seq = sequence ?: throw PhaseError("STALE_RUN", "No phase run")
        if (runId != config?.runId) throw PhaseError("STALE_RUN", "Phase run was replaced")
        if (!(terminalStop && seq.terminal) && expected != revision) throw PhaseError("STALE_REVISION", "Phase state changed; refresh status")
        return seq
    }
    private fun expectedRevision(call: PluginCall): Long {
        val n = (call.data.opt("revision") as? Number)?.toDouble()
            ?: throw PhaseError("INVALID_ARGUMENT", "Invalid revision")
        if (!n.isFinite() || n % 1.0 != 0.0 || n < 0 || n > 9_007_199_254_740_991.0) throw PhaseError("INVALID_ARGUMENT", "Invalid revision")
        return n.toLong()
    }
    fun command(c: Context, call: PluginCall, action: String): JSObject {
        val sound = if (action == "sound") call.data.opt("sound") as? Boolean
            ?: throw PhaseError("INVALID_ARGUMENT", "Invalid sound") else false
        return mutate(c, call.getString("runId"), expectedRevision(call), action, sound)
    }
    private fun mutate(c: Context, runId: String?, expectedRevision: Long?, action: String, sound: Boolean = false): JSObject {
        val seq = expected(c, runId, expectedRevision, action == "stop")
        when (action) {
            "pause" -> {
                if (seq.status != "running") throw PhaseError("INVALID_STATE", "Only a running phase can pause")
                seq.pause(now()); finalAudio = false
                commit(c); service?.releaseTiming(); service?.finishService()
                cancelPending("START_CANCELLED", "Phase paused during startup")
                if (service == null) c.stopService(Intent(c, GymPhaseService::class.java))
            }
            "stop" -> {
                if (!seq.terminal) {
                    seq.stop(); finalAudio = false; commit(c)
                    cancelPending("START_CANCELLED", "Phase stopped during startup")
                }
                finalAudio = false
                service?.releaseTiming(); service?.finishService()
                if (service == null) c.stopService(Intent(c, GymPhaseService::class.java))
            }
            "sound" -> {
                if (config!!.sound != sound) {
                    config = config!!.copy(sound = sound)
                    commit(c)
                    if (!sound) {
                        finalAudio = false
                        service?.stopAudio()
                        if (seq.status == "completed") service?.finishService()
                    }
                    if (seq.status == "running") {
                        service?.updateNotification(notification(c))
                        service?.scheduleBoundary()
                    }
                }
            }
        }
        return snapshot()
    }
    fun resume(c: Context, call: PluginCall) {
        val seq = expected(c, call.getString("runId"), expectedRevision(call))
        if (seq.status != "paused") throw PhaseError("INVALID_STATE", "Only a paused phase can resume")
        seq.resume(now()); audioError = null
        try { revision++; persist(c); begin(c, call, true) }
        catch (e: Exception) {
            val hadPending = pending != null
            failStart(c, e)
            if (!hadPending) call.reject(e.message ?: "Could not persist phase", if (e is PhaseError) e.code else "FGS_START_FAILED")
        }
    }
    fun replaceWithRest(c: Context) {
        load(c)
        val seq = sequence ?: return
        if (seq.status == "running" || seq.status == "paused" || pending != null) {
            seq.stop(); finalAudio = false; commit(c)
            cancelPending("START_CANCELLED", "Phase replaced by Rest")
            service?.releaseTiming(); service?.finishService()
            if (service == null) c.stopService(Intent(c, GymPhaseService::class.java))
        } else if (finalAudio) {
            // The final boundary was already committed; replacing its audio cannot undo completion.
            finalAudio = false
            service?.releaseTiming(); service?.finishService()
            emit()
        }
    }
    fun blocksRestAudio(c: Context): Boolean { load(c); return sequence?.status == "running" || sequence?.status == "paused" || pending != null || finalAudio }

    fun attach(s: GymPhaseService, intent: Intent?): Boolean {
        load(s)
        val seq = sequence
        val cfg = config
        if (seq == null || cfg == null || seq.status != "running" || (intent?.getStringExtra("runId") != null && intent.getStringExtra("runId") != cfg.runId)) return false
        val fresh = pending?.runId == cfg.runId
        if (!fresh && (boot != boot(s) || userStopped(s))) {
            seq.interrupt(if (boot != boot(s)) "reboot" else "user_stopped"); commit(s); return false
        }
        service = s
        try {
            s.enterForeground(notification(s))
            if (fresh) {
                seq.deadline = now() + seq.remaining
                commit(s)
                s.updateNotification(notification(s))
            }
            if (!fresh) {
                seq.advance(now(), true)
                commit(s)
                if (seq.status != "running") { s.finishService(); return false }
                // The foreground notification posted above predates this commit; republish current revision/stage/round.
                s.updateNotification(notification(s))
            }
            s.holdWake(seq.totalLeft(now()) + AUDIO_GRACE)
            if (fresh) {
                // Commit foreground success before acknowledging or attempting the first gong.
                emit()
                val waiting = pending
                pending = null
                waiting?.let { handler.removeCallbacks(it.timeout); it.call.resolve(snapshot()) }
                if (intent?.getBooleanExtra("resume", false) != true) gong(s)
            }
            s.scheduleBoundary()
            return true
        } catch (e: Exception) { failStart(s, e); return false }
    }
    private fun advance(c: Context) {
        val seq = sequence ?: return
        val count = seq.advance(now())
        if (count == 0) return
        finalAudio = seq.status == "completed" && config!!.sound
        try { commit(c) }
        catch (_: Exception) {
            seq.interrupt("storage_failed"); finalAudio = false
            service?.releaseTiming(); service?.finishService(); emit(); return
        }
        val s = service ?: return
        if (seq.status == "completed") {
            s.cancelBoundary()
            s.holdWake(AUDIO_GRACE)
            s.updateNotification(notification(c))
            if (config!!.sound) gong(s) else s.finishService()
        } else {
            s.updateNotification(notification(c))
            if (count == 1) gong(s) // Coalesce delayed boundaries; never play a backlog.
            s.scheduleBoundary()
        }
    }
    fun boundary(s: GymPhaseService, runId: String, rev: Long, segment: Int) {
        if (service !== s || config?.runId != runId || revision != rev || sequence?.segmentIndex != segment || sequence?.status != "running") return
        advance(s)
        if (sequence?.status == "running") s.scheduleBoundary()
    }
    fun boundaryIdentity(): Triple<String, Long, Int>? = config?.let { Triple(it.runId, revision, sequence!!.segmentIndex) }
    fun boundaryDelay() = sequence?.left(now()) ?: 0L
    private fun gong(s: GymPhaseService) {
        if (config?.sound != true) return
        val run = config!!.runId
        s.playAudio { error ->
            if (service !== s || config?.runId != run) return@playAudio
            if (error != null) {
                audioError = error
                try { commit(s) } catch (_: Exception) {}
                if (sequence?.status == "running") {
                    s.updateNotification(notification(s))
                    s.scheduleBoundary()
                }
            }
            if (sequence?.status == "completed") {
                finalAudio = false; emit(); s.finishService()
            }
        }
    }
    fun detached(s: GymPhaseService) {
        if (service !== s) return
        service = null; finalAudio = false
        if (sequence?.status == "running" && pending == null) {
            sequence!!.interrupt("service_destroyed")
            try { commit(s) } catch (_: Exception) {}
        }
    }
    fun timeout(s: GymPhaseService) {
        if (service !== s) return
        sequence?.interrupt("service_timeout"); finalAudio = false
        try { commit(s) } catch (_: Exception) {}
        s.releaseTiming(); s.finishService()
    }
    fun notificationAction(c: Context, intent: Intent) {
        try { mutate(c, intent.getStringExtra("runId"), intent.getLongExtra("revision", -1), intent.action ?: "") }
        catch (_: PhaseError) { /* An obsolete notification must not control a newer run/revision. */ }
    }
    private fun channels(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Workout intervals", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
    }
    private fun notification(c: Context): Notification {
        channels(c)
        val cfg = config!!; val seq = sequence!!
        val open = PendingIntent.getActivity(c, NOTE, Intent(c, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        fun action(name: String): PendingIntent = PendingIntent.getBroadcast(c, if (name == "pause") NOTE + 1 else NOTE + 2,
            Intent(c, GymPhaseReceiver::class.java).setAction(name).setData(Uri.Builder().scheme("gymphase").authority("action").appendPath(cfg.runId).appendPath(revision.toString()).appendPath(name).build())
                .putExtra("runId", cfg.runId).putExtra("revision", revision), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val label = if (seq.status == "completed") cfg.doneLabel else if (seq.stage == "rest") cfg.restLabel else cfg.workLabel
        val builder = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(cfg.title).setContentText("$label · ${seq.round}/${cfg.rounds}")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS).setPriority(NotificationCompat.PRIORITY_LOW)
        if (seq.status == "running") builder.setWhen(System.currentTimeMillis() + seq.left(now())).setUsesChronometer(true).setChronometerCountDown(true)
            .addAction(android.R.drawable.ic_media_pause, actionLabel(c, true), action("pause"))
        builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, actionLabel(c, false), action("stop"))
        return builder.build()
    }
    private fun actionLabel(c: Context, pause: Boolean): String = when (c.resources.configuration.locales[0].language) {
        "sk" -> if (pause) "Pozastaviť" else "Zastaviť"
        "es" -> if (pause) "Pausar" else "Detener"
        "pt" -> if (pause) "Pausar" else "Parar"
        "fr" -> if (pause) "Pause" else "Arrêter"
        "ar" -> if (pause) "إيقاف مؤقت" else "إيقاف"
        else -> if (pause) "Pause" else "Stop"
    }
}

class GymPhaseReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { GymPhase.notificationAction(context, intent) }
}

class GymPhaseService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var boundary: Runnable? = null
    private var wake: PowerManager.WakeLock? = null
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    private var audioIdentity: Any? = null
    private var audioTimeout: Runnable? = null
    private var audioDone: ((String?) -> Unit)? = null
    private var startId = 0
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        this.startId = startId
        if (!GymPhase.attach(this, intent)) { stopSelfResult(startId); return START_NOT_STICKY }
        return START_STICKY
    }
    internal fun enterForeground(note: Notification) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(GymPhase.NOTE, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(GymPhase.NOTE, note)
    }
    internal fun updateNotification(note: Notification) {
        try { NotificationManagerCompat.from(this).notify(GymPhase.NOTE, note) } catch (_: SecurityException) {}
    }
    internal fun holdWake(timeout: Long) {
        wake?.let { if (it.isHeld) it.release() }
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GymLift:phase").apply {
            setReferenceCounted(false); acquire(timeout.coerceIn(1L, 86_406_000L))
        }
    }
    internal fun cancelBoundary() { boundary?.let { handler.removeCallbacks(it) }; boundary = null }
    internal fun scheduleBoundary() {
        cancelBoundary()
        val identity = GymPhase.boundaryIdentity() ?: return
        boundary = Runnable { GymPhase.boundary(this, identity.first, identity.second, identity.third) }
        handler.postDelayed(boundary!!, GymPhase.boundaryDelay().coerceAtLeast(1L))
    }
    internal fun playAudio(done: (String?) -> Unit) {
        stopAudio()
        audioDone = done
        val identity = Any()
        audioIdentity = identity
        val manager = getSystemService(AudioManager::class.java)
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener({ change -> if (change < 0 && audioIdentity === identity) endAudio("focus_lost") }, handler).build()
        focus = request
        try {
            if (manager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { endAudio("focus_denied"); return }
            val media = MediaPlayer()
            player = media
            media.setAudioAttributes(attrs)
            media.setDataSource(this, Uri.parse("android.resource://$packageName/${R.raw.rest_chime}"))
            media.setOnCompletionListener { if (player === it) endAudio(null) }
            media.setOnErrorListener { mp, _, _ -> if (player === mp) endAudio("playback_failed"); true }
            media.prepare(); media.start()
            audioTimeout = Runnable { if (player === media) endAudio("playback_timeout") }
            handler.postDelayed(audioTimeout!!, 5_000)
        } catch (_: Exception) { endAudio("playback_failed") }
    }
    private fun endAudio(error: String?) {
        val done = audioDone
        audioDone = null
        audioIdentity = null
        audioTimeout?.let { handler.removeCallbacks(it) }; audioTimeout = null
        player?.release(); player = null
        focus?.let { getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }; focus = null
        done?.invoke(error)
    }
    internal fun stopAudio() { audioDone = null; endAudio(null) }
    internal fun releaseTiming() {
        cancelBoundary(); stopAudio()
        wake?.let { if (it.isHeld) it.release() }; wake = null
    }
    internal fun finishService() { releaseTiming(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelfResult(startId) }
    override fun onTimeout(startId: Int) { GymPhase.timeout(this) }
    override fun onDestroy() {
        releaseTiming(); GymPhase.detached(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
