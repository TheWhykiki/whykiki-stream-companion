/**
 * Schlankes Logging für Core und CLI.
 * Sammelt Zeilen für Logdateien und schreibt parallel auf die Konsole.
 */

export type LogStufe = "info" | "ok" | "warnung" | "fehler";

export class Protokoll {
  private zeilen: string[] = [];
  private still: boolean;

  constructor(optionen?: { still?: boolean }) {
    this.still = optionen?.still ?? false;
  }

  log(stufe: LogStufe, nachricht: string): void {
    const zeile = `[${new Date().toISOString()}] [${stufe.toUpperCase()}] ${nachricht}`;
    this.zeilen.push(zeile);
    if (!this.still) {
      const ausgabe = stufe === "fehler" ? console.error : console.log;
      ausgabe(zeile);
    }
  }

  info(n: string): void { this.log("info", n); }
  ok(n: string): void { this.log("ok", n); }
  warnung(n: string): void { this.log("warnung", n); }
  fehler(n: string): void { this.log("fehler", n); }

  alleZeilen(): string[] {
    return [...this.zeilen];
  }

  alsText(): string {
    return this.zeilen.join("\n");
  }
}
