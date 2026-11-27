package surotvsk.gymapp.wear;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;

/** Jednoduché skrolovateľné Views s bezpečným okrajom pre okrúhly displej. */
public final class WatchActivity extends Activity {
    private static final int LIME = 0xFFD6F35A, TEXT = 0xFFF4F3EF, MUTED = 0xFFA6A5A0, SURFACE = 0xFF1A1A1C;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WatchLink link;
    private WatchTimer timer;
    private ScrollView scroll;
    private LinearLayout column;
    private TextView countdown, commandStatus;
    private String page = "home", language = "";
    private int timerShape = Integer.MIN_VALUE;
    private final char[] clockDigits = new char[16];
    private char zeroDigit = java.text.DecimalFormatSymbols.getInstance().getZeroDigit();
    private long clockSeconds = -1;
    private long revision = -1, ticks;
    private boolean timerWasLive;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            try {
                if (ticks++ % 3 == 0) link.refresh();
                JSONObject local = timer.state();
                int shape = local.optString("id").hashCode();
                shape = 31 * shape + (local.optBoolean("paused") ? 1 : 0);
                shape = 31 * shape + (local.optBoolean("done") ? 1 : 0);
                shape = 31 * shape + (local.optBoolean("restored") ? 1 : 0);
                shape = 31 * shape + (timer.exact() ? 1 : 0);
                shape = 31 * shape + (timer.notifications() ? 1 : 0);
                long current = link.revision();
                String nextLanguage = link.language();
                if (!nextLanguage.isEmpty() && !nextLanguage.equals(language)) setLanguage(nextLanguage);
                if (current != revision || shape != timerShape) {
                    revision = current; timerShape = shape; render(true);
                }
                updateClocks();
            } catch (Exception e) { failure(R.string.timer_error); }
            handler.postDelayed(this, 1000);
        }
    };
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        link = WatchLink.get(this); timer = WatchTimer.get(this);
        if (savedInstanceState != null) page = savedInstanceState.getString("page", "home");
        scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setClipToPadding(false);
        column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setGravity(Gravity.CENTER_HORIZONTAL);
        boolean round = getResources().getConfiguration().isScreenRound();
        int side = round ? Math.max(24, getResources().getConfiguration().screenWidthDp / 7) : 16;
        column.setPadding(dp(side), dp(round ? 30 : 16), dp(side), dp(round ? 44 : 24));
        scroll.addView(column, new ScrollView.LayoutParams(-1, -2));
        scroll.setFocusable(true);
        final float rotary = ViewConfiguration.get(this).getScaledVerticalScrollFactor();
        scroll.setOnGenericMotionListener((v, event) -> {
            if (event.getAction() != MotionEvent.ACTION_SCROLL) return false;
            float delta = event.getAxisValue(MotionEvent.AXIS_SCROLL);
            if (delta == 0) return false;
            scroll.scrollBy(0, Math.round(-delta * rotary)); return true;
        });
        setContentView(scroll); scroll.requestFocus(); render(false);
    }
    @Override protected void onResume() {
        super.onResume(); timer.restore(); link.refresh(); handler.removeCallbacks(ticker); handler.post(ticker);
    }
    @Override protected void onPause() { handler.removeCallbacks(ticker); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("page", page); super.onSaveInstanceState(out); }
    @Override public void onBackPressed() {
        if (!page.equals("home")) go("home"); else super.onBackPressed();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void setLanguage(String tag) {
        language = tag;
        Configuration config = new Configuration(getResources().getConfiguration());
        Locale locale = Locale.forLanguageTag(tag); config.setLocale(locale); config.setLayoutDirection(locale);
        zeroDigit = java.text.DecimalFormatSymbols.getInstance(locale).getZeroDigit();
        clockSeconds = -1;
        getResources().updateConfiguration(config, getResources().getDisplayMetrics());
        column.setLayoutDirection(config.getLayoutDirection()); revision = -1;
    }
    private TextView text(CharSequence value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.CENTER); view.setPadding(0, dp(5), 0, dp(5));
        column.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view;
    }
    private void note(int resource) { text(getString(resource), 13, MUTED); }
    private void title(int resource) { TextView t = text(getString(resource), 21, TEXT); t.setTypeface(null, Typeface.BOLD); }
    private Button button(CharSequence label, boolean enabled, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setTextSize(14);
        button.setTextColor(enabled ? LIME : MUTED); button.setMinHeight(dp(48)); button.setGravity(Gravity.CENTER);
        button.setPadding(dp(8), dp(6), dp(8), dp(6));
        GradientDrawable background = new GradientDrawable(); background.setColor(SURFACE); background.setCornerRadius(dp(24));
        button.setBackground(background); button.setEnabled(enabled); button.setAlpha(enabled ? 1f : .55f);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(4), 0, dp(4));
        column.addView(button, params); button.setOnClickListener(v -> action.run()); return button;
    }
    private void button(int label, Runnable action) { button(getString(label), true, action); }
    private void go(String next) { page = next; render(false); scroll.scrollTo(0, 0); }
    private void render(boolean preserveScroll) {
        int oldY = preserveScroll ? scroll.getScrollY() : 0;
        column.removeAllViews(); countdown = null; commandStatus = null; clockSeconds = -1;
        JSONObject snapshot = link.visible();
        switch (page) {
            case "workout": workout(snapshot); break;
            case "rest":
                title(R.string.rest_timer);
                button(R.string.phone_timer, () -> go("phone")); button(R.string.watch_only, () -> go("local")); break;
            case "phone": phoneTimer(snapshot); break;
            case "local": localTimer(); break;
            case "timer-settings": timerPermissions(); break;
            case "calendar": calendar(snapshot); break;
            case "link": linking(snapshot); break;
            default:
                title(R.string.home);
                if (snapshot == null) note(link.linkedGeneration() ? R.string.disconnected : R.string.not_linked);
                else text(getString(R.string.linked_to, snapshot.optJSONObject("binding").optString("label")), 12, MUTED);
                Button start = button(getString(R.string.start_workout), true, () -> go("workout"));
                GradientDrawable startBackground = new GradientDrawable();
                startBackground.setColor(LIME); startBackground.setCornerRadius(dp(24));
                start.setBackground(startBackground); start.setTextColor(0xFF121212);
                button(R.string.rest_timer, () -> go("rest"));
                button(R.string.calendar, () -> go("calendar")); button(R.string.connect_phone, () -> go("link"));
        }
        if (!page.equals("home")) button(R.string.back, () -> go("home"));
        scroll.post(() -> scroll.scrollTo(0, oldY)); updateClocks();
    }
    private boolean requirePhone(JSONObject snapshot) {
        if (snapshot != null) return true;
        note(link.linkedGeneration() ? R.string.unavailable : R.string.unlinked_help); return false;
    }
    private void status() { commandStatus = text(getString(link.outcome()), 13, MUTED); }
    private JSONObject args(String key, Object value) {
        JSONObject object = new JSONObject();
        try { object.put(key, value); } catch (Exception e) { throw new IllegalArgumentException(e); }
        return object;
    }
    private void send(String type, JSONObject args) { link.submit(type, args); render(true); }
    private void workout(JSONObject snapshot) {
        title(R.string.start_workout); note(R.string.phone_required);
        if (!requirePhone(snapshot)) return;
        JSONObject session = snapshot.optJSONObject("session");
        if (session != null) {
            text(session.optString("planName"), 17, LIME);
            text(getString(R.string.session_progress, session.optInt("done"), session.optInt("total")), 15, TEXT);
            if (!session.optString("exerciseName").isEmpty()) text(session.optString("exerciseName"), 14, MUTED);
            note(R.string.session_active);
        } else {
            JSONArray plans = snapshot.optJSONArray("plans");
            if (plans == null || plans.length() == 0) note(R.string.no_plans);
            else for (int i = 0; i < plans.length(); i++) {
                JSONObject plan = plans.optJSONObject(i);
                if (plan == null) continue;
                String id = plan.optString("id");
                text(plan.optString("name"), 17, TEXT);
                text(getString(R.string.sets, plan.optInt("sets")), 13, MUTED);
                if (plan.optBoolean("recommended")) note(R.string.recommended);
                button(getString(R.string.start_plan, plan.optString("name")), !link.busy(), () -> send("startWorkout", args("planId", id)));
            }
        }
        status();
    }
    private void phoneTimer(JSONObject snapshot) {
        title(R.string.phone_timer);
        if (!requirePhone(snapshot)) return;
        JSONObject rest = snapshot.optJSONObject("rest");
        if (rest == null || rest.optBoolean("done")) {
            note(R.string.timer_empty);
            for (int duration : new int[]{60, 90, 120}) button(getString(R.string.start_seconds, duration), !link.busy(), () -> send("restStart", args("seconds", duration)));
        } else {
            countdown = text("", 48, LIME);
            if (rest.optLong("pausedLeftMs") > 0) note(R.string.paused);
            button(getString(R.string.add_time), !link.busy(), () -> send("restAdd", args("seconds", 15)));
            button(getString(R.string.stop), !link.busy(), () -> new AlertDialog.Builder(this)
                .setTitle(R.string.stop).setMessage(R.string.phone_timer_help)
                .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.stop, (d, w) -> send("restStop", new JSONObject())).show());
        }
        status();
    }
    private interface TimerAction { void run() throws Exception; }
    private void mutate(TimerAction action) {
        try { action.run(); render(true); } catch (Exception e) { failure(R.string.timer_error); }
    }
    private void localTimer() {
        title(R.string.watch_only);
        JSONObject state = timer.state(); long left = timer.remaining(); timerWasLive = left > 0;
        if (left > 0) {
            countdown = text("", 48, LIME);
            if (state.optBoolean("paused")) note(R.string.paused);
            button(state.optBoolean("paused") ? R.string.resume : R.string.pause,
                () -> mutate(() -> { if (timer.state().optBoolean("paused")) timer.resume(); else timer.pause(); }));
            button(R.string.add_time, () -> mutate(() -> timer.add()));
            button(R.string.stop, () -> new AlertDialog.Builder(this).setTitle(R.string.stop_timer_title)
                .setMessage(R.string.stop_timer_message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.stop, (d, w) -> mutate(() -> timer.stop())).show());
        } else {
            note(state.optBoolean("done") ? R.string.rest_done : R.string.timer_empty);
            for (int duration : new int[]{60, 90, 120}) button(getString(R.string.start_seconds, duration), true, () -> mutate(() -> timer.start(duration)));
        }
        if (state.optBoolean("restored")) note(R.string.timer_restored);
        if (state.optBoolean("invalid")) note(R.string.timer_invalid);
        if (!timer.exact()) note(R.string.alerts_late);
        button(R.string.timer_options, () -> go("timer-settings"));
    }
    private void timerPermissions() {
        title(R.string.timer_options);
        note(timer.exact() ? R.string.exact_allowed : R.string.exact_denied);
        if (!timer.exact()) button(R.string.exact_settings, () -> {
            if (Build.VERSION.SDK_INT >= 31) openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
        });
        note(timer.notifications() ? R.string.notification_allowed : R.string.notification_denied);
        if (!timer.notifications()) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                button(R.string.allow_notifications, () -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1));
            button(R.string.notification_settings, () -> openSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        }
    }
    private void updateClocks() {
        if (commandStatus != null) commandStatus.setText(link.outcome());
        if (countdown == null) return;
        long left = 0;
        if (page.equals("local")) {
            left = timer.remaining();
            if (timerWasLive && left <= 0) { timerWasLive = false; render(true); return; }
        } else if (page.equals("phone")) {
            JSONObject s = link.visible(), rest = s == null ? null : s.optJSONObject("rest");
            if (rest != null && !rest.optBoolean("done")) left = rest.optLong("pausedLeftMs") > 0
                ? rest.optLong("pausedLeftMs") : Math.max(0, rest.optLong("endAt") - System.currentTimeMillis());
        }
        long seconds = (left + 999) / 1000;
        if (seconds == clockSeconds) return;
        clockSeconds = seconds;
        int pos = clockDigits.length;
        clockDigits[--pos] = (char) (zeroDigit + seconds % 10);
        clockDigits[--pos] = (char) (zeroDigit + (seconds / 10) % 6);
        clockDigits[--pos] = ':';
        long minutes = seconds / 60;
        do {
            clockDigits[--pos] = (char) (zeroDigit + minutes % 10);
            minutes /= 10;
        } while (minutes > 0);
        countdown.setText(clockDigits, pos, clockDigits.length - pos);
    }
    private void calendar(JSONObject snapshot) {
        title(R.string.calendar); note(R.string.calendar_read_only);
        if (!requirePhone(snapshot)) return;
        JSONArray days = snapshot.optJSONArray("calendar");
        if (days == null || days.length() == 0) { note(R.string.calendar_empty); return; }
        for (int i = 0; i < days.length(); i++) {
            JSONObject day = days.optJSONObject(i); if (day == null) continue;
            text(day.optString("date"), 16, LIME); text(day.optString("title"), 15, TEXT);
            note(day.optString("status").equals("completed") ? R.string.completed : R.string.planned);
        }
    }
    private void linking(JSONObject snapshot) {
        title(R.string.connect_phone);
        if (snapshot != null) text(getString(R.string.linked_to, snapshot.optJSONObject("binding").optString("label")), 15, LIME);
        else note(link.linkedGeneration() ? R.string.unavailable : R.string.not_linked);
        note(R.string.unlinked_help);
        if (link.linkedGeneration()) button(R.string.unlink, () -> new AlertDialog.Builder(this).setTitle(R.string.unlink_title)
            .setMessage(R.string.unlink_message).setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.unlink, (d, w) -> {
                try { link.unlink(); render(false); } catch (Exception e) { column.removeAllViews(); note(R.string.unlink_error); button(R.string.back, () -> go("home")); }
            }).show());
    }
    private void openSettings(Intent intent) {
        try { startActivity(intent); } catch (Exception e) { failure(R.string.permission_unavailable); }
    }
    private void failure(int message) { new AlertDialog.Builder(this).setMessage(message).setPositiveButton(android.R.string.ok, null).show(); }
}
