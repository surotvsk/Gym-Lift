package surotvsk.gymapp

/** Clock-free sequence arithmetic. Callers serialize mutations and persist before side effects. */
internal class PhaseSequence(val workMs: Long, val restMs: Long, val rounds: Int) {
    init {
        require(workMs in 1_000L..3_600_000L && workMs % 1_000L == 0L)
        require(restMs in 0L..3_600_000L && restMs % 1_000L == 0L)
        require(rounds in 1..100)
        require(workMs * rounds + restMs * (rounds - 1) <= 86_400_000L)
    }

    // Virtual rest indices remain reserved even when zero-length rests are skipped.
    val segmentCount: Int get() = rounds * 2 - 1
    var segmentIndex = 0
    var deadline = 0L
    var remaining = workMs
    var status = "running"
    var lastTransition = 0
    var interruptedReason: String? = null
    val terminal: Boolean get() = status == "stopped" || status == "completed" || status == "interrupted"
    val stage: String? get() = if (terminal) null else if (restMs > 0 && segmentIndex % 2 == 1) "rest" else "work"
    val round: Int get() = (segmentIndex / 2 + 1).coerceAtMost(rounds)
    fun duration(index: Int) = if (index % 2 == 1) restMs else workMs
    fun left(now: Long): Long = if (status == "running") (deadline - now).coerceAtLeast(0L) else if (status == "paused") remaining else 0L
    fun totalLeft(now: Long): Long {
        if (status != "running" && status != "paused") return 0L
        var total = left(now)
        for (index in segmentIndex + 1 until segmentCount) total += duration(index)
        return total
    }

    /** Returns boundaries committed. A recovery never silently completes after a process gap. */
    fun advance(now: Long, recovery: Boolean = false): Int {
        if (status != "running") return 0
        var crossed = 0
        while (now >= deadline && status == "running") {
            crossed++
            if (segmentIndex + 1 == segmentCount) {
                lastTransition = segmentCount
                status = if (recovery) "interrupted" else "completed"
                if (recovery) interruptedReason = "process_gap"
                remaining = 0L
            } else {
                segmentIndex += if (restMs == 0L) 2 else 1
                lastTransition = segmentIndex
                deadline += duration(segmentIndex)
                remaining = duration(segmentIndex)
            }
        }
        if (recovery && status == "running") interruptedReason = "process_restart"
        return crossed
    }

    fun pause(now: Long) {
        check(status == "running")
        remaining = left(now)
        status = "paused"
    }
    fun resume(now: Long) {
        check(status == "paused")
        deadline = now + remaining
        status = "running"
    }
    fun interrupt(reason: String) { status = "interrupted"; interruptedReason = reason; remaining = 0L }
    fun stop() { status = "stopped"; remaining = 0L }
}
