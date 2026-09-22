/** Footer link. Lives in the scrolling thread so the composer can own the bottom edge. */
export function ReportBug() {
  return (
    <p className="report-bug">
      <a href="https://www.changuito.me/reportarbug" target="_blank" rel="noopener noreferrer">
        Reportar un bug
      </a>
    </p>
  );
}
