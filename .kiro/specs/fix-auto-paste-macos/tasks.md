# Implementation Plan

- [x] 1. Dodaj dependency `core-graphics` jako macOS-only
  - Dodaj `core-graphics = "0.25"` do sekcji `[target.'cfg(target_os = "macos")'.dependencies]` w `src-tauri/Cargo.toml`
  - Jeśli sekcja nie istnieje, utwórz ją
  - Zweryfikuj że `cargo check` przechodzi na macOS
  - _Requirements: 1.1, 3.1_

- [x] 2. Zaimplementuj nową funkcję `perform_paste()` opartą na CGEvent
  - [x] 2.1 Zamień obecną implementację `perform_paste()` na CGEvent w `src-tauri/src/lib.rs`
    - Użyj `CGEventSource::new(CGEventSourceStateID::HIDSystemState)`
    - Utwórz key-down i key-up events z keycode `9` (kVK_ANSI_V)
    - Ustaw `CGEventFlags::CGEventFlagCommand` na obu eventach
    - Wyślij eventy przez `post(CGEventTapLocation::HID)`
    - Dodaj odpowiednie logowanie z prefixem `[Dictato]`
    - _Requirements: 1.1, 3.1, 3.3_

  - [x] 2.2 Przenieś obecną implementację AppleScript do `perform_paste_fallback()`
    - Zmień nazwę obecnej funkcji `perform_paste()` (macOS cfg) na `perform_paste_fallback()`
    - Zachowaj pełną istniejącą logikę osascript bez zmian
    - Dodaj `#[cfg(target_os = "macos")]` attribute
    - _Requirements: 4.2_

- [x] 3. Zaktualizuj `copy_and_paste()` z fallback i lepszym logowaniem
  - [x] 3.1 Dodaj logikę fallback w `copy_and_paste()` w `src-tauri/src/lib.rs`
    - W `spawn_blocking` closure: najpierw `perform_paste()`, jeśli błąd to `perform_paste_fallback()`
    - Loguj którą metodą paste się udało: `"(CGEvent)"` lub `"(AppleScript fallback)"`
    - _Requirements: 4.1, 4.2, 3.3_

  - [x] 3.2 Zwiększ delay z 100ms na 150ms
    - Zmień `tokio::time::sleep(Duration::from_millis(100))` na `150`
    - _Requirements: 1.4_

- [x] 4. Zaktualizuj obsługę błędów i komunikaty
  - Upewnij się, że w przypadku błędu obu metod paste, tekst pozostaje w schowku i użytkownik dostaje jasny log
  - Sprawdź że komunikat o brakujących uprawnieniach Accessibility jest wystarczająco jasny (linie 491-493)
  - Sprawdź że `check_accessibility_permissions()` jest wywoływane przed próbą paste (obecna logika)
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.3_

- [x] 5. Wyczyść nieużywany import `enigo` na macOS i zweryfikuj kompilację
  - Upewnij się, że `enigo` import jest nadal za `#[cfg(not(target_os = "macos"))]`
  - Uruchom `cargo check` aby zweryfikować że build przechodzi
  - Uruchom `cargo check --target x86_64-unknown-linux-gnu` (jeśli dostępne) lub zweryfikuj że non-macOS path nadal kompiluje się poprawnie
  - _Requirements: 3.1_
