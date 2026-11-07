package surotvsk.gymapp

import android.content.MutableContextWrapper
import android.util.Base64
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.security.MessageDigest
import java.security.SecureRandom

/** Token aj nonce sú iba v pamäti; žiadny automatický výber účtu alebo prihlasovanie pri štarte. */
@CapacitorPlugin(name = "GymGoogle")
class GymGooglePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var choosing = false

    @PluginMethod
    fun signIn(call: PluginCall) {
        val clientId = call.getString("clientId") ?: ""
        if (!Regex("[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com").matches(clientId)) {
            call.reject("Google sign-in is not configured", "NOT_CONFIGURED"); return
        }
        scope.launch {
            if (choosing) { call.reject("Google chooser is already open", "BUSY"); return@launch }
            choosing = true
            try {
                val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
                val nonce = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
                val digest = MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray(Charsets.UTF_8))
                    .joinToString("") { "%02x".format(it) }
                val option = GetSignInWithGoogleOption.Builder(clientId).setNonce(digest).build()
                val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
                val result = CredentialManager.create(context).getCredential(MutableContextWrapper(activity), request)
                val credential = result.credential
                if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    call.reject("Unexpected credential type", "UNAVAILABLE"); return@launch
                }
                val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                call.resolve(JSObject().put("token", token).put("nonce", nonce))
            } catch (_: GetCredentialCancellationException) {
                call.resolve(JSObject().put("cancelled", true))
            } catch (_: NoCredentialException) {
                call.reject("No Google credential available", "NO_CREDENTIAL")
            } catch (_: CancellationException) {
                call.resolve(JSObject().put("cancelled", true))
            } catch (_: Exception) {
                // Správa poskytovateľa môže obsahovať osobné údaje; neposielať ju do logu ani UI.
                call.reject("Google sign-in unavailable", "UNAVAILABLE")
            } finally { choosing = false }
        }
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        scope.launch {
            try { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
            catch (_: Exception) { /* Odhlásenie aplikácie už platí aj pri nedostupnom poskytovateľovi. */ }
            call.resolve()
        }
    }

    override fun handleOnDestroy() { scope.cancel(); super.handleOnDestroy() }
}
