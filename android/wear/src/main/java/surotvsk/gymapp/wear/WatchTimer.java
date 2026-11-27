package surotvsk.gymapp.wear;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import org.json.JSONObject;
import java.util.UUID;

/** Nezávislý anonymný časovač; nikdy sa neprepíše snapshotom telefónu. */
final class WatchTimer {
    private static WatchTimer instance;
    static synchronized WatchTimer get(Context c) {
        if (instance == null) instance = new WatchTimer(c.getApplicationContext());
        return instance;
    }
    private static final long MAX = 86400000;
    private static final String CHANNEL = "watch_rest";
    private final Context context;
    private final WearDisk disk;
    private JSONObject state;
    private WatchTimer(Context c) { context = c; disk = new WearDisk(c, "gymwear-timer.json"); state = disk.readOrEmpty(); }
    synchronized JSONObject state() { reconcile(false); return state; }
    synchronized long remaining() {
        reconcile(false);
        if (state.optBoolean("done") || state.optString("id").isEmpty()) return 0;
        if (state.optBoolean("paused")) return state.optLong("pausedLeftMs");
        return Math.max(0, state.optLong("dueElapsed") - SystemClock.elapsedRealtime());
    }
    boolean exact() {
        AlarmManager a = context.getSystemService(AlarmManager.class);
        return Build.VERSION.SDK_INT < 31 || a.canScheduleExactAlarms();
    }
    boolean notifications() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && manager.areNotificationsEnabled() && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
    }
    private PendingIntent alarm() {
        Intent intent = new Intent(context, WatchTimerReceiver.class).setAction("surotvsk.gymapp.wear.TIMER");
        intent.putExtra("id", state.optString("id"));
        return PendingIntent.getBroadcast(context, 21, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private void cancel() { context.getSystemService(AlarmManager.class).cancel(alarm()); }
    private void save() { disk.write(state); }
    private void schedule() {
        cancel();
        if (state.optString("id").isEmpty() || state.optBoolean("done") || state.optBoolean("paused")) return;
        AlarmManager a = context.getSystemService(AlarmManager.class);
        long due = state.optLong("dueElapsed");
        if (exact()) {
            try { a.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, due, alarm()); return; }
            catch (SecurityException ignored) { /* Povolenie sa mohlo medzičasom zmeniť. */ }
        }
        a.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, due, alarm());
    }
    synchronized void start(int seconds) throws Exception {
        WearProtocol.require(seconds > 0 && seconds <= 86400 && WearProtocol.boot(context) >= 0, "timer_duration_or_boot");
        cancel(); long duration = seconds * 1000L;
        state = new JSONObject().put("id", UUID.randomUUID().toString()).put("endAt", System.currentTimeMillis() + duration)
            .put("dueElapsed", SystemClock.elapsedRealtime() + duration).put("boot", WearProtocol.boot(context))
            .put("pausedLeftMs", 0).put("paused", false).put("done", false).put("restored", false);
        save(); context.getSystemService(NotificationManager.class).cancel(21); schedule();
    }
    synchronized void pause() throws Exception {
        long left = remaining();
        if (left <= 0 || state.optBoolean("paused")) return;
        state.put("paused", true).put("pausedLeftMs", left).put("endAt", 0).put("dueElapsed", 0);
        save(); cancel();
    }
    synchronized void resume() throws Exception {
        if (!state.optBoolean("paused") || state.optLong("pausedLeftMs") <= 0) return;
        long left = state.getLong("pausedLeftMs");
        state.put("paused", false).put("endAt", System.currentTimeMillis() + left)
            .put("dueElapsed", SystemClock.elapsedRealtime() + left).put("boot", WearProtocol.boot(context)).put("pausedLeftMs", 0);
        save(); schedule();
    }
    synchronized void add() throws Exception {
        long left = remaining();
        if (left <= 0 || left > MAX - 15000) return;
        if (state.optBoolean("paused")) state.put("pausedLeftMs", left + 15000);
        else state.put("endAt", System.currentTimeMillis() + left + 15000)
            .put("dueElapsed", SystemClock.elapsedRealtime() + left + 15000);
        save(); schedule();
    }
    synchronized void stop() {
        cancel(); state = new JSONObject(); save(); context.getSystemService(NotificationManager.class).cancel(21);
    }
    synchronized void restore() { reconcile(true); schedule(); }
    synchronized void alarm(String id) {
        if (!id.equals(state.optString("id"))) return;
        reconcile(false);
        // Predčasný / starý alarm nemá ukončiť predĺžený ani pozastavený časovač.
        if (!state.optBoolean("done") && !state.optBoolean("paused")) schedule();
    }
    private void reconcile(boolean bootEvent) {
        try {
            if (state.optString("id").isEmpty() || state.optBoolean("done") || state.optBoolean("paused")) return;
            int boot = WearProtocol.boot(context);
            if (boot < 0) { cancel(); state = new JSONObject().put("invalid", true); save(); return; }
            if (state.optInt("boot", -1) != boot) {
                long left = state.optLong("endAt") - System.currentTimeMillis();
                if (left <= 0 || left > MAX) {
                    cancel(); state.put("done", true).put("restored", true).put("dueElapsed", 0); save(); return;
                }
                state.put("boot", boot).put("dueElapsed", SystemClock.elapsedRealtime() + left).put("restored", true);
                save(); schedule();
            }
            if (SystemClock.elapsedRealtime() >= state.optLong("dueElapsed")) {
                // Najprv trvalý stav; opakovaný receiver nesmie opakovať upozornenie.
                state.put("done", true); save(); cancel();
                if (!bootEvent) alert();
            }
        } catch (Exception e) { throw new IllegalStateException("watch_timer_state", e); }
    }
    private void alert() {
        Vibrator vibrator = context.getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 250, 150, 250}, -1));
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, context.getString(R.string.timer_channel), NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true); manager.createNotificationChannel(channel);
        if (!notifications()) return;
        PendingIntent open = PendingIntent.getActivity(context, 22, new Intent(context, WatchActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_watch)
            .setContentTitle(context.getString(R.string.rest_done)).setContentText(context.getString(R.string.watch_only))
            .setCategory(Notification.CATEGORY_ALARM).setContentIntent(open).setAutoCancel(true).build();
        try { manager.notify(21, notification); } catch (SecurityException ignored) { /* UI naďalej ukazuje zamietnuté povolenie. */ }
    }
}
