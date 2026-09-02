"""Regenerates 'gas/full gas.txt' as a byte-faithful concatenation of every gas/*.gs file.

Format, reverse-engineered from the pre-existing file and verified byte-for-byte against it:

    section = "// " + "="*64 + "\n"
              "// <Filename.gs>\n"
              "// " + "="*64 + "\n"
              "\n"
              <file contents, which already end in a newline>
              "\n"                      <- one blank line closing the section
    bundle  = "\n".join(sections)       <- the join adds a second blank line BETWEEN sections

so consecutive sections are separated by two blank lines, and the file ends with exactly one
trailing blank line (the last section's closing newline, with no join after it).

Sorted by filename in byte order, which is what puts Backfill.gs before BacklogAgingApi.gs and
IncidentsApi.gs before InitiativesApi.gs. Only .gs files are included; appsscript.json and
README.md are not part of the bundle. Line endings are normalised to LF — one source file,
SupabaseMigration.gs, is CRLF on disk, and the bundle has always stored it as LF.

Verification is two-sided, because a plausible-looking bundle that quietly reflows whitespace is
the exact failure this script exists to prevent:
  1. every section extracted back out of the new bundle must equal its source file;
  2. every section for a file this session did not edit must be byte-identical to that same
     section in the previous bundle (pass its path as argv[1]).
"""
import io
import os
import sys

GAS_DIR = 'gas'
OUT = os.path.join(GAS_DIR, 'full gas.txt')
RULE = '// ' + '=' * 64

# Everything this session changed. Any OTHER file's section differing from the previous bundle
# means the format drifted, not that the code changed.
EDITED = {'Backfill.gs', 'SupabaseClient.gs'}


def read(path):
    """Source text with line endings normalised to LF.

    newline=None (the default) is universal-newlines mode, which translates CRLF and lone CR to
    LF on read. Reading verbatim instead would embed CRLF for the one CRLF source file alone and
    leave the bundle inconsistent with itself and with every previous version of it.
    """
    with io.open(path, encoding='utf-8') as fh:
        return fh.read()


def split_sections(bundle):
    """{filename: section body including its closing blank line} for a bundle in this format."""
    parts = {}
    idx = 0
    while True:
        head = bundle.find(RULE + '\n// ', idx)
        if head == -1:
            return parts
        name_end = bundle.find('\n', head + len(RULE) + 4)
        name = bundle[head + len(RULE) + 4:name_end]
        body_start = bundle.find('\n\n', name_end) + 2
        nxt = bundle.find('\n' + RULE + '\n// ', body_start)
        parts[name] = bundle[body_start:nxt] if nxt != -1 else bundle[body_start:]
        idx = nxt if nxt != -1 else len(bundle)


def main():
    previous_path = sys.argv[1] if len(sys.argv) > 1 else None

    names = sorted(f for f in os.listdir(GAS_DIR) if f.endswith('.gs'))
    if not names:
        sys.exit('no .gs files found')

    sections = ['%s\n// %s\n%s\n\n%s\n' % (RULE, name, RULE, read(os.path.join(GAS_DIR, name)))
                for name in names]
    bundle = '\n'.join(sections)

    with io.open(OUT, 'w', encoding='utf-8', newline='') as fh:
        fh.write(bundle)

    print('wrote %s: %d files, %d lines, %d bytes'
          % (OUT, len(names), bundle.count('\n'), len(bundle.encode('utf-8'))))

    failures = []

    # (1) round-trip: each extracted section is its source file plus the closing blank line.
    extracted = split_sections(bundle)
    for name in names:
        if name not in extracted:
            failures.append('%s: header not found in bundle' % name)
        elif extracted[name] != read(os.path.join(GAS_DIR, name)) + '\n':
            failures.append('%s: extracted section does not match source file' % name)

    # (2) format stability: untouched files must be byte-identical to the previous bundle.
    if previous_path and os.path.exists(previous_path):
        before = split_sections(read(previous_path))
        checked = 0
        for name, body in before.items():
            if name in EDITED:
                continue
            checked += 1
            if name not in extracted:
                failures.append('%s: present in previous bundle, missing now' % name)
            elif extracted[name] != body:
                failures.append('%s: section differs from previous bundle (format drift)' % name)
        print('format-stability check: compared %d untouched sections against the previous bundle'
              % checked)
    else:
        print('format-stability check: SKIPPED (no previous bundle given)')

    if failures:
        sys.exit('VERIFY FAILED:\n  ' + '\n  '.join(failures))
    print('verified: %d sections round-trip to source; untouched sections byte-identical to the '
          'previous bundle' % len(names))


main()
