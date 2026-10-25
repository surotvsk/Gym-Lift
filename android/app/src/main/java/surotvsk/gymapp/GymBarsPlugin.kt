package surotvsk.gymapp

import android.content.res.Configuration
import android.graphics.Color
import androidx.core.view.WindowCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * GymQuest system bars in the app theme. Called from script.js (nativeThemeBars) as Capacitor.Plugins.GymBars:
 *  setColors({ color: "#E9E8E4", dark: false }) → {}
 *
 * Capacitor 8 (SystemBars) pads the WebView inside the status and navigation bars, so what shows
 * behind both bars is the window's background, which follows the PHONE's light/dark mode, not the
 * theme chosen in the app (grey/black bars in the light theme on a phone in dark mode). This sets
 * that background to the app's colour and the icons of both bars to match (dark = light icons).
 * SystemBars resets the background on every configuration change (phone dark mode, rotation…),
 * so the last colours are re-applied right after it.
 */
@CapacitorPlugin(name = "GymBars")
class GymBarsPlugin : Plugin() {
    private var color: Int? = null
    private var dark = false

    @PluginMethod
    fun setColors(call: PluginCall) {
        val parsed = try { Color.parseColor(call.getString("color") ?: "") } catch (_: IllegalArgumentException) { null }
        if (parsed == null) { call.reject("bad_color"); return }
        color = parsed
        dark = call.getBoolean("dark", false) ?: false
        activity.runOnUiThread { apply(); call.resolve() }
    }

    override fun handleOnConfigurationChanged(newConfig: Configuration?) {
        super.handleOnConfigurationChanged(newConfig)
        // after SystemBars' own handler (same pass) has put the default background back
        if (color != null) activity.window.decorView.post { apply() }
    }

    private fun apply() {
        val c = color ?: return
        val window = activity.window
        window.decorView.setBackgroundColor(c)
        val insets = WindowCompat.getInsetsController(window, window.decorView)
        insets.isAppearanceLightStatusBars = !dark
        insets.isAppearanceLightNavigationBars = !dark
    }
}
