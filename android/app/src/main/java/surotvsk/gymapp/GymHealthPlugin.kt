package surotvsk.gymapp

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

/**
 * GymQuest ↔ Health Connect. Called from script.js as Capacitor.Plugins.GymHealth:
 *  isAvailable()              → { available }
 *  checkPermissions()         → { granted: [...] }  (no prompt)
 *  requestPermissions()       → { granted: ["READ_HEART_RATE", "READ_ACTIVE_CALORIES_BURNED", "WRITE_EXERCISE"] }
 *  readStats({start, end})    → { hrAvg?, hrMax?, hrCount, kcal? }   (ISO-8601 instants, the workout's window)
 *  writeWorkout({id, start, end, title}) → { ok }  weightlifting session, clientRecordId = workout id (upsert)
 *  deleteWorkout({id})        → { ok }
 * Only the workout's own time window is read; only GymQuest's own sessions are written or deleted.
 */
@CapacitorPlugin(name = "GymHealth")
class GymHealthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val contract = PermissionController.createRequestPermissionResultContract()

    private val names = linkedMapOf(
        HealthPermission.getReadPermission(HeartRateRecord::class) to "READ_HEART_RATE",
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class) to "READ_ACTIVE_CALORIES_BURNED",
        HealthPermission.getWritePermission(ExerciseSessionRecord::class) to "WRITE_EXERCISE",
    )

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    private fun grantedResult(granted: Set<String>): JSObject {
        val arr = JSArray()
        names.forEach { (perm, name) -> if (granted.contains(perm)) arr.put(name) }
        return JSObject().put("granted", arr)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", client() != null))
    }

    /** Currently granted permissions, without asking (they can be revoked in Health Connect at any time). */
    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        val c = client() ?: return call.resolve(grantedResult(emptySet()))
        scope.launch {
            try {
                call.resolve(grantedResult(c.permissionController.getGrantedPermissions()))
            } catch (e: Exception) {
                call.resolve(grantedResult(emptySet()))
            }
        }
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        scope.launch {
            try {
                val granted = c.permissionController.getGrantedPermissions()
                if (granted.containsAll(names.keys)) {
                    call.resolve(grantedResult(granted))
                } else {
                    startActivityForResult(call, contract.createIntent(context, names.keys), "permissionsResult")
                }
            } catch (e: Exception) {
                call.reject(e.message ?: "permission_error")
            }
        }
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = try { contract.parseResult(result.resultCode, result.data) } catch (e: Exception) { emptySet() }
        call.resolve(grantedResult(granted))
    }

    @PluginMethod
    fun readStats(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        val start = parse(call.getString("start")) ?: return call.reject("bad_start")
        val end = parse(call.getString("end")) ?: return call.reject("bad_end")
        if (!end.isAfter(start)) return call.reject("bad_window")
        val range = TimeRangeFilter.between(start, end)
        scope.launch {
            val out = JSObject().put("hrCount", 0)
            try {
                val hr = c.aggregate(AggregateRequest(
                    metrics = setOf(HeartRateRecord.BPM_AVG, HeartRateRecord.BPM_MAX, HeartRateRecord.MEASUREMENTS_COUNT),
                    timeRangeFilter = range))
                val count = hr[HeartRateRecord.MEASUREMENTS_COUNT] ?: 0L
                out.put("hrCount", count)
                if (count > 0) {
                    hr[HeartRateRecord.BPM_AVG]?.let { out.put("hrAvg", it) }
                    hr[HeartRateRecord.BPM_MAX]?.let { out.put("hrMax", it) }
                }
            } catch (e: Exception) { /* bez povolenia na tep: nič */ }
            try {
                val kc = c.aggregate(AggregateRequest(metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL), timeRangeFilter = range))
                kc[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { out.put("kcal", it.inKilocalories) }
            } catch (e: Exception) { /* bez povolenia na kalórie: nič */ }
            call.resolve(out)
        }
    }

    @PluginMethod
    fun writeWorkout(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        val id = call.getString("id")?.takeIf { it.isNotBlank() } ?: return call.reject("bad_id")
        val start = parse(call.getString("start")) ?: return call.reject("bad_start")
        val end = parse(call.getString("end")) ?: return call.reject("bad_end")
        if (!end.isAfter(start)) return call.reject("bad_window")
        val zone = ZoneId.systemDefault().rules
        val record = ExerciseSessionRecord(
            startTime = start,
            startZoneOffset = zone.getOffset(start),
            endTime = end,
            endZoneOffset = zone.getOffset(end),
            metadata = Metadata.manualEntry(clientRecordId = id, clientRecordVersion = System.currentTimeMillis()),
            exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING,
            title = call.getString("title")?.take(100),
        )
        scope.launch {
            try {
                c.insertRecords(listOf(record))
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject(e.message ?: "write_error")
            }
        }
    }

    @PluginMethod
    fun deleteWorkout(call: PluginCall) {
        val c = client() ?: return call.reject("unavailable")
        val id = call.getString("id")?.takeIf { it.isNotBlank() } ?: return call.reject("bad_id")
        scope.launch {
            try {
                c.deleteRecords(ExerciseSessionRecord::class, recordIdsList = emptyList(), clientRecordIdsList = listOf(id))
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject(e.message ?: "delete_error")
            }
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    private fun parse(s: String?): Instant? = try { if (s == null) null else Instant.parse(s) } catch (e: Exception) { null }
}
