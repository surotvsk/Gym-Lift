package com.getcapacitor.myapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import surotvsk.gymapp.HeartRateSeries;
import surotvsk.gymapp.HrSample;
import org.junit.Test;

/** Zmenšenie tepu: najviac 300 bodov, zoradené, max koša ostane, vzorky mimo okna preč. */
public class HeartRateSeriesTest {
    @Test
    public void keepsMaxPerBucketSortedAndCapped() {
        List<HrSample> raw = new ArrayList<>();
        for (int i = 0; i < 3000; i++) raw.add(new HrSample(1000L + i * 10L, 100 + (i % 50)));
        raw.add(new HrSample(1000L + 1234L * 10L + 3L, 190));   // špička musí prežiť
        Collections.shuffle(raw, new java.util.Random(1));
        List<HrSample> out = HeartRateSeries.INSTANCE.downsample(raw, 1000L, 1000L + 30000L, 300);
        assertTrue(out.size() <= 300);
        long max = 0;
        for (int i = 0; i < out.size(); i++) {
            if (i > 0) assertTrue(out.get(i).getT() >= out.get(i - 1).getT());
            max = Math.max(max, out.get(i).getBpm());
        }
        assertEquals(190L, max);
    }

    @Test
    public void dropsOutsideWindowAndKeepsSmallSeries() {
        List<HrSample> raw = new ArrayList<>();
        raw.add(new HrSample(5L, 90));
        raw.add(new HrSample(50L, 100));
        raw.add(new HrSample(20L, 110));
        raw.add(new HrSample(500L, 120));
        List<HrSample> out = HeartRateSeries.INSTANCE.downsample(raw, 10L, 100L, 300);
        assertEquals(2, out.size());
        assertEquals(20L, out.get(0).getT());
        assertEquals(50L, out.get(1).getT());
        assertEquals(0, HeartRateSeries.INSTANCE.downsample(raw, 100L, 10L, 300).size());
    }
}
