# NHZ Climate Range Card

Eine Lovelace-Karte mit gemeinsamer Zeitraumwahl für Klimaprofil-Graphen in Home Assistant. Die Karte liest vorhandene HA-Entitäten und Recorder-Langzeitstatistiken. Sie enthält keine Site-Konfiguration und keine Zugangsdaten.

## Installation über HACS

Dieses Repository in HACS unter **Custom repositories** als Typ **Dashboard** eintragen. Danach die Ressource `/hacsfiles/nhz-climate-range-card/nhz-climate-range-card.js` als JavaScript-Modul verwenden. Die Karte benötigt außerdem die separat installierte `apexcharts-card` sowie NHZ-Klimaprofil-Entitäten aus der API-Integration. Eine Aufnahme in das HACS-Standardverzeichnis ist nicht erforderlich.

Ein Dashboard kann dann `type: custom:nhz-climate-range-card` mit `graphs` konfigurieren. Jede Graph-Konfiguration benötigt `title`, `explanation`, `profile_entity` und `source_entity`. Das Profil liefert die Attribute `hourly_normal`, `daily_normal`, `seven_day_normal` und die entsprechenden historischen Reihen. Die Quellen-Entity muss zu Größe und Einheit des Profils passen.

Für flüssigen Regen kann eine lokale kumulative mm-Entity als `aggregate_source_entity` und `aggregate_statistic: change` angegeben werden. Mit `precipitation_view: true` zeigt die Karte bei 7 und 30 Tagen den kumulierten lokalen Regen gegen den Profil-Durchschnitt; bei 90 und 365 Tagen nutzt sie die Wochenänderung. Die lokale Regenrate kann separat als `source_entity` für den heutigen Verlauf dienen. Ein Regenzähler darf **nicht** ohne Schnee-/Wasseräquivalent-Semantik als Gesamtniederschlag einschließlich Schnee konfiguriert werden.

```yaml
type: custom:nhz-climate-range-card
default_range: 30d
graphs:
  - title: Regen
    explanation: flüssiger Niederschlag
    profile_entity: sensor.example_rain_climate_profile
    source_entity: sensor.example_rain_rate
    aggregate_source_entity: sensor.example_total_rain
    aggregate_statistic: change
    precipitation_view: true
```

## Datenstatus

Die Karte mischt derzeit keine lokalen Messstunden mit ERA5-/ICON-IST als Lückenfüllung und weist die Stundenabdeckung noch nicht aus. Summen aus lückenhaften HA-Statistiken können deshalb zu niedrig sein. Die 90-/365-Tage-Ansicht verwendet derzeit HA-Kalenderwochenstatistiken. Die geplante stundenweise Quellenpriorität und Monatsdarstellung sind noch nicht Teil dieses Pakets. Die Referenzperiode wird durch das Klimaprofil der API bestimmt, nicht durch die Karte.
