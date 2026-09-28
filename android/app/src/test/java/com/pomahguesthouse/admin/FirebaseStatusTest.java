package com.pomahguesthouse.admin;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FirebaseStatusTest {
    @Test
    public void recognizesFirebaseFailures() {
        assertTrue(FirebaseStatus.isPushFailure(
            new IllegalStateException("Default FirebaseApp is not initialized in this process")
        ));
        assertTrue(FirebaseStatus.isPushFailure(
            new RuntimeException(new IllegalStateException("FirebaseApp initialization unsuccessful"))
        ));
        assertFalse(FirebaseStatus.isPushFailure(
            new IllegalStateException("You need to use a Theme.AppCompat theme (or descendant) with this activity.")
        ));
        assertFalse(FirebaseStatus.isPushFailure(new RuntimeException("WebView renderer exited")));
    }
}
