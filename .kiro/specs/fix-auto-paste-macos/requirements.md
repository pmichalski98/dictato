# Requirements Document

## Introduction

Funkcja auto-paste w aplikacji Dictato nie działa poprawnie na macOS (Sequoia/Sonoma). Po zakończeniu transkrypcji tekst jest prawidłowo kopiowany do schowka, ale automatyczne wklejenie (symulacja Cmd+V) nie następuje. Użytkownik musi ręcznie wkleić tekst. Problem występuje mimo przyznania uprawnień Accessibility w System Settings.

Obecna implementacja używa `osascript` do uruchomienia AppleScript (`tell application "System Events" to keystroke "v" using command down`), co jest podatne na problemy z uprawnieniami na nowszych wersjach macOS i nie zapewnia niezawodnej informacji zwrotnej o błędach.

Celem jest zastąpienie mechanizmu auto-paste bardziej niezawodnym rozwiązaniem opartym na natywnym API macOS (CGEvent) oraz dodanie lepszej diagnostyki i obsługi błędów.

## Requirements

### Requirement 1: Niezawodne auto-wklejanie na macOS

**User Story:** Jako użytkownik Dictato, chcę aby transkrypcja była automatycznie wklejana w aktywną aplikację po zakończeniu nagrywania, żeby nie musieć ręcznie wciskać Cmd+V.

#### Acceptance Criteria

1. WHEN transkrypcja zakończy się pomyślnie AND auto-paste jest włączone, THEN system SHALL wkleić tekst w aktywną aplikację docelową za pomocą natywnego API macOS (CGEvent) zamiast AppleScript/osascript.
2. WHEN auto-paste jest wyłączone w ustawieniach, THEN system SHALL tylko skopiować tekst do schowka bez próby wklejenia.
3. WHEN floating window jest widoczne podczas transkrypcji, THEN system SHALL upewnić się, że floating window nie przejmuje fokusa od aplikacji docelowej.
4. WHEN system wykonuje auto-paste, THEN system SHALL odczekać wystarczający czas (co najmniej 100ms) po zapisie do schowka przed symulacją Cmd+V.

### Requirement 2: Diagnostyka i obsługa błędów uprawnień Accessibility

**User Story:** Jako użytkownik Dictato, chcę widzieć jasne komunikaty gdy auto-paste nie działa, żebym wiedział co zrobić aby to naprawić.

#### Acceptance Criteria

1. WHEN uprawnienia Accessibility nie są przyznane, THEN system SHALL wyświetlić użytkownikowi komunikat z instrukcją nawigacji do System Settings → Privacy & Security → Accessibility.
2. WHEN auto-paste nie powiedzie się (CGEvent zwróci błąd), THEN system SHALL poinformować użytkownika że tekst jest w schowku i może go wkleić ręcznie (Cmd+V).
3. WHEN użytkownik uruchomi aplikację po raz pierwszy z włączonym auto-paste, THEN system SHALL sprawdzić uprawnienia Accessibility i poinformować o konieczności ich przyznania jeśli brakuje.

### Requirement 3: Wsparcie dla macOS Sequoia i kompatybilność

**User Story:** Jako użytkownik macOS Sequoia, chcę aby auto-paste działało poprawnie mimo zaostrzonych wymagań bezpieczeństwa tego systemu.

#### Acceptance Criteria

1. WHEN aplikacja działa na macOS Sequoia (15.x), THEN system SHALL używać CGEvent API które jest bardziej niezawodne niż AppleScript na tej wersji systemu.
2. WHEN uprawnienia Accessibility zostały zresetowane przez system (Sequoia resetuje je okresowo), THEN system SHALL wykryć brak uprawnień i poinformować użytkownika o konieczności ponownego przyznania.
3. WHEN auto-paste jest wykonywane, THEN system SHALL logować wynik operacji (sukces/porażka) do konsoli deweloperskiej z wystarczającymi szczegółami do debugowania.

### Requirement 4: Fallback i graceful degradation

**User Story:** Jako użytkownik, chcę aby transkrypcja zawsze była dostępna w schowku nawet jeśli auto-paste nie zadziała.

#### Acceptance Criteria

1. WHEN auto-paste nie powiedzie się z dowolnego powodu, THEN system SHALL zachować tekst w schowku i NIE zwracać błędu do frontendu (tekst powinien być zawsze dostępny do ręcznego wklejenia).
2. IF CGEvent API nie jest dostępne, THEN system SHALL próbować fallback do AppleScript jako drugiej opcji przed zgłoszeniem błędu.
3. WHEN użytkownik ma włączone auto-paste ale brak uprawnień Accessibility, THEN system SHALL skopiować tekst do schowka i wyświetlić jednorazowe powiadomienie o brakujących uprawnieniach.
