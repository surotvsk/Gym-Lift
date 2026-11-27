package surotvsk.gymapp.wear;

/** Odmietnutie so stabilným kódom; nikdy nenesie text správy ani obsah používateľa. */
public final class JournalError extends RuntimeException {
    public final String code;
    public JournalError(String code) { super(code); this.code = code; }
    public JournalError(String code, Throwable cause) { super(code, cause); this.code = code; }
}
