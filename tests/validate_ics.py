"""Validate a MentorFlow .ics with the python `icalendar` library (pip install icalendar).
Usage: python3 tests/validate_ics.py file.ics [expected_events]  -> prints JSON summary, exits 1 on problems."""
import sys, json
from icalendar import Calendar
raw = open(sys.argv[1], 'rb').read()
problems = []
if b'\r\n' not in raw: problems.append('lines must end with CRLF')
for i, line in enumerate(raw.split(b'\r\n')):
    if len(line) > 75: problems.append(f'line {i+1} longer than 75 octets')
cal = Calendar.from_ical(raw)
if str(cal.get('VERSION')) != '2.0': problems.append('VERSION must be 2.0')
if not cal.get('PRODID'): problems.append('missing PRODID')
tzs = [c for c in cal.walk('VTIMEZONE')]
if not tzs or str(tzs[0].get('TZID')) != 'Europe/London': problems.append('missing Europe/London VTIMEZONE')
events = []
for ev in cal.walk('VEVENT'):
    for req in ('UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'SEQUENCE'):
        if ev.get(req) is None: problems.append(f'event missing {req}')
    ds, de = ev.decoded('DTSTART'), ev.decoded('DTEND')
    if str(ev['DTSTART'].params.get('TZID')) != 'Europe/London': problems.append('DTSTART without TZID')
    if de <= ds: problems.append('DTEND before DTSTART')
    events.append({'uid': str(ev['UID']), 'summary': str(ev['SUMMARY']), 'start': ds.isoformat(), 'utcoffset': str(ds.utcoffset()),
                   'status': str(ev.get('STATUS')), 'seq': int(ev.get('SEQUENCE')), 'alarms': len(ev.walk('VALARM')),
                   'categories': [str(c) for c in ev.get('CATEGORIES').cats] if ev.get('CATEGORIES') else [],
                   'location': str(ev.get('LOCATION') or ''), 'description': str(ev.get('DESCRIPTION') or '')})
if '£' in raw.decode('utf-8'): problems.append('money must not appear in calendar export')
if len(sys.argv) > 2 and len(events) != int(sys.argv[2]): problems.append(f'expected {sys.argv[2]} events, got {len(events)}')
print(json.dumps({'events': events, 'problems': problems}, ensure_ascii=False))
sys.exit(1 if problems else 0)
