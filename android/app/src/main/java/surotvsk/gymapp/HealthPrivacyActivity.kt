package surotvsk.gymapp

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Health Connect opens this when the user asks why GymQuest wants health data
 * (ACTION_SHOW_PERMISSIONS_RATIONALE / VIEW_PERMISSION_USAGE). It shows the privacy policy.
 */
class HealthPrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL)))
        } catch (e: Exception) { /* bez prehliadača */ }
        finish()
    }

    companion object {
        const val PRIVACY_URL = "https://surotvsk.github.io/Gymquest/privacy.html"
    }
}
