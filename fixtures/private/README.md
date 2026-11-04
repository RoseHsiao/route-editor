# Private fixtures (gitignored)

Put real-world files here that you need for local testing but that **must not be
committed or redistributed**: personal GPS tracks, and third-party datasets whose
licence you have not verified.

Everything in this directory except this README is ignored by git.

Example: a GPX file downloaded from a third-party trail website can be useful for
checking the import pipeline against real data. Keep it here, and never copy it into
`fixtures/synthetic/`, seed data, or test snapshots.
