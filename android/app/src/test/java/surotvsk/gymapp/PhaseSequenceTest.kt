package surotvsk.gymapp

import org.junit.Assert.*
import org.junit.Test

class PhaseSequenceTest {
    @Test fun oneRoundHasNoRest() {
        val seq = PhaseSequence(60_000, 30_000, 1).apply { deadline = 60_000 }
        assertEquals(1, seq.segmentCount)
        assertEquals(60_000L, seq.totalLeft(0))
        assertEquals(1, seq.advance(60_000))
        assertEquals("completed", seq.status)
        assertNull(seq.stage)
        assertEquals(1, seq.lastTransition)
        assertEquals(0L, seq.left(60_000))
    }

    @Test fun tenRoundsHaveTenWorksAndNineRests() {
        val seq = PhaseSequence(60_000, 30_000, 10).apply { deadline = 60_000 }
        var works = 0
        var rests = 0
        assertEquals(870_000L, seq.totalLeft(0))
        while (seq.status == "running") {
            if (seq.stage == "work") works++ else rests++
            assertEquals(1, seq.advance(seq.deadline))
        }
        assertEquals(10, works)
        assertEquals(9, rests)
        assertEquals(19, seq.lastTransition)
        assertEquals(10, seq.round)
        assertEquals("completed", seq.status)
    }

    @Test fun zeroRestHasNoRestStageOrExtraTransition() {
        val seq = PhaseSequence(1_000, 0, 10).apply { deadline = 1_000 }
        assertEquals(19, seq.segmentCount)
        repeat(10) {
            assertEquals("work", seq.stage)
            assertEquals(it + 1, seq.round)
            assertEquals(it * 2, seq.segmentIndex)
            assertEquals(1, seq.advance(seq.deadline))
        }
        assertEquals("completed", seq.status)
        assertEquals(19, seq.lastTransition)
    }

    @Test fun deadlinesAdvanceFromPreviousBoundaryNotCallbackTime() {
        val seq = PhaseSequence(60_000, 30_000, 2).apply { deadline = 60_000 }
        assertEquals(1, seq.advance(60_800))
        assertEquals(90_000L, seq.deadline)
        assertEquals(29_200L, seq.left(60_800))
        assertEquals(1, seq.advance(90_900))
        assertEquals(150_000L, seq.deadline)
        assertEquals("work", seq.stage)
    }

    @Test fun delayedCallbackCoalescesMultipleSegments() {
        val seq = PhaseSequence(1_000, 1_000, 4).apply { deadline = 1_000 }
        assertEquals(4, seq.advance(4_500))
        assertEquals(4, seq.segmentIndex)
        assertEquals(4, seq.lastTransition)
        assertEquals(3, seq.round)
        assertEquals("work", seq.stage)
        assertEquals(5_000L, seq.deadline)
        assertEquals(0, seq.advance(4_500))
    }

    @Test fun pauseAtBoundaryFreezesTheNewStageAfterReconciliation() {
        val seq = PhaseSequence(60_000, 30_000, 2).apply { deadline = 60_000 }
        seq.advance(60_000)
        seq.pause(60_000)
        assertEquals("paused", seq.status)
        assertEquals("rest", seq.stage)
        assertEquals(30_000L, seq.remaining)
        assertEquals(30_000L, seq.left(900_000))
        assertEquals(0, seq.advance(900_000))
    }

    @Test fun resumeRetainsSegmentAndTransitionIdentity() {
        val seq = PhaseSequence(60_000, 30_000, 2).apply { deadline = 60_000 }
        seq.pause(12_000)
        seq.resume(900_000)
        assertEquals(948_000L, seq.deadline)
        assertEquals(0, seq.segmentIndex)
        assertEquals(0, seq.lastTransition)
        assertEquals(138_000L, seq.totalLeft(900_000))
    }

    @Test fun recoveryBeforeFinalBoundaryContinuesWithoutReplayingTransitions() {
        val seq = PhaseSequence(1_000, 1_000, 4).apply { deadline = 1_000 }
        assertEquals(4, seq.advance(4_500, true))
        assertEquals("running", seq.status)
        assertEquals("process_restart", seq.interruptedReason)
        assertEquals(4, seq.lastTransition)
        assertEquals(0, seq.advance(4_500))
    }

    @Test fun recoveryPastFinalBoundaryNeverAwardsCompletion() {
        val seq = PhaseSequence(1_000, 1_000, 2).apply { deadline = 1_000 }
        assertEquals(3, seq.advance(9_000, true))
        assertEquals("interrupted", seq.status)
        assertEquals("process_gap", seq.interruptedReason)
        assertNull(seq.stage)
        assertEquals(0L, seq.totalLeft(9_000))
        assertEquals(0, seq.advance(99_000))
    }

    @Test fun processRecoveryExactlyAtFinalBoundaryIsInterrupted() {
        val seq = PhaseSequence(1_000, 0, 1).apply { deadline = 1_000 }
        seq.advance(1_000, true)
        assertEquals("interrupted", seq.status)
        assertEquals("process_gap", seq.interruptedReason)
    }

    @Test fun stoppedAndInterruptedRunsNeverAdvance() {
        val stopped = PhaseSequence(1_000, 0, 1).apply { deadline = 1_000; stop() }
        assertEquals(0, stopped.advance(9_000))
        assertEquals("stopped", stopped.status)
        val interrupted = PhaseSequence(1_000, 0, 1).apply { deadline = 1_000; interrupt("reboot") }
        assertEquals(0, interrupted.advance(9_000))
        assertEquals("reboot", interrupted.interruptedReason)
        assertNull(interrupted.stage)
    }

    @Test fun monotonicInputDoesNotDependOnWallClock() {
        val seq = PhaseSequence(1_000, 0, 2).apply { deadline = 51_000 }
        assertEquals(500L, seq.left(50_500))
        assertEquals(0, seq.advance(50_999))
        assertEquals(1, seq.advance(51_000))
        assertEquals(52_000L, seq.deadline)
    }

    @Test fun validatesBoundsBeforeTotalArithmetic() {
        val invalid = arrayOf(
            Triple(0L, 0L, 1), Triple(999L, 0L, 1), Triple(1_001L, 0L, 1),
            Triple(3_601_000L, 0L, 1), Triple(1_000L, -1L, 1), Triple(1_000L, 1L, 1),
            Triple(1_000L, 3_601_000L, 1), Triple(1_000L, 0L, 0), Triple(1_000L, 0L, 101),
            Triple(Long.MAX_VALUE, Long.MAX_VALUE, Int.MAX_VALUE), Triple(3_600_000L, 3_600_000L, 100)
        )
        for ((work, rest, rounds) in invalid) {
            try { PhaseSequence(work, rest, rounds); fail("Accepted invalid $work/$rest/$rounds") }
            catch (_: IllegalArgumentException) { }
        }
        assertEquals(86_400_000L, PhaseSequence(3_600_000, 0, 24).apply { deadline = 3_600_000 }.totalLeft(0))
    }
}
