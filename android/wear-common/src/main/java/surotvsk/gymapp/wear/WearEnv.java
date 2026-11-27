package surotvsk.gymapp.wear;

/** Čas, počet štartov a identifikátory pre čistú logiku denníka (testy dosadzujú pevné hodnoty). */
public interface WearEnv {
    long wall();
    /** Počet štartov zariadenia; záporné číslo = neznáme. */
    int boot();
    String uuid();
}
