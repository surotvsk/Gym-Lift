package surotvsk.gymapp

/** Jeden údaj o tepe: čas v epoch ms a údery za minútu. */
data class HrSample(val t: Long, val bpm: Long)

/**
 * Zmenšenie tepu na graf: vzorky mimo okna [start, end] preč, zoradiť podľa času a rozdeliť okno na
 * najviac `maxPoints` časových košov; z každého koša ostane vzorka s najvyšším tepom (max sa nestratí).
 * Výsledok je zoradený podľa času a má najviac `maxPoints` bodov.
 */
object HeartRateSeries {
    const val MAX_POINTS = 300

    fun downsample(raw: List<HrSample>, start: Long, end: Long, maxPoints: Int = MAX_POINTS): List<HrSample> {
        if (end <= start || maxPoints < 1) return emptyList()
        val inWindow = raw.filter { it.t in start..end && it.bpm > 0 }.sortedBy { it.t }
        if (inWindow.size <= maxPoints) return inWindow
        val span = end - start
        val best = HashMap<Int, HrSample>()
        for (s in inWindow) {
            val bucket = (((s.t - start).toDouble() / span) * maxPoints).toInt().coerceIn(0, maxPoints - 1)
            val cur = best[bucket]
            if (cur == null || s.bpm > cur.bpm) best[bucket] = s
        }
        return best.entries.sortedBy { it.key }.map { it.value }
    }
}
