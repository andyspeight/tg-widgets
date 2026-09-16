/**
 * Who is reading your site: the chart parts of the results screen.
 *
 * The first slice of the Duda visibility upgrade (docs/duda-visibility-review.md,
 * 15 Sep 2026). Duda's headline finding is that AI crawler visits predict AI
 * recommendations, and these are the pieces that show a client whether those
 * crawlers have come, alongside the people the site is for and the assistants
 * that sent them. components/results/ResultsDashboard.tsx lays them out on the
 * board (direction A of the mockups Andy chose on 16 Sep 2026), because people
 * want to see results, not read them.
 *
 * A SERVER COMPONENT WITH NO SCRIPT, like the rest of the screen. Every chart is
 * plain HTML and CSS or a small inline SVG: a column is a flex stack of three
 * divs whose heights are percentages, a bar is a div with a width, the donut is
 * three dashed circles, a sparkline is one path, and the hover tooltip is a
 * hidden label that CSS shows on :hover. Text stays real text at every width,
 * so the phone gets the same chart at the same type size rather than a
 * shrunken picture of one. Nothing here imports from Next, so the panel can be
 * rendered on its own for the browser smoke test.
 *
 * THE RULES IT FOLLOWS (the tool's data-visualisation rules): the form fits
 * the question (change over time is columns, part of a whole is one ring,
 * magnitude by name is bars, a trend is a sparkline, one number is a tile);
 * colour says which series and nothing else; a legend for more than one
 * series; labels chosen, not one on every point; marks no thicker than 24px
 * with a 2px surface gap between stacked segments and between slices; the value
 * text in the text tokens, never the series colour; a table view for the
 * columns; dark mode selected from its own validated steps, not flipped. The
 * two authored movements, the columns rising and the ring drawing in, are CSS
 * inside a prefers-reduced-motion guard.
 *
 * NUMBERS ONLY. The tally behind this stores no IP, no user agent, no cookie,
 * so there is nothing here about anybody, only how many.
 */

import type { BarView, DailyView, DonutView, EngineView, TileView } from '../../lib/visits/chart';

const SERIES = [
  { key: 'visitor', series: 1, label: 'People' },
  { key: 'ai', series: 2, label: 'From an AI assistant' },
  { key: 'crawler', series: 3, label: 'Crawlers' },
] as const;

const number = (value: number) => value.toLocaleString('en-GB');

export function Tile({ tile }: { tile: TileView }) {
  return (
    <div className="viz-tile" data-series={tile.series}>
      <span className="viz-tile__label">{tile.label}</span>
      <span className="viz-tile__value">{number(tile.value)}</span>
      <svg
        className="viz-spark"
        viewBox={`0 0 ${tile.spark.width} ${tile.spark.height}`}
        width={tile.spark.width}
        height={tile.spark.height}
        aria-hidden="true"
        data-flat={tile.spark.any ? undefined : ''}
      >
        {tile.spark.area && <path className="viz-spark__area" d={tile.spark.area} />}
        {tile.spark.line && <path className="viz-spark__line" d={tile.spark.line} />}
      </svg>
      {tile.delta ? (
        <span className="viz-tile__delta" data-direction={tile.delta.direction}>
          <strong>{tile.delta.label}</strong> {tile.delta.note}
        </span>
      ) : (
        <span className="viz-tile__note">{tile.note}</span>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <ul className="viz-legend" aria-label="Series">
      {SERIES.map((series) => (
        <li key={series.key}>
          <span className="viz-swatch" data-series={series.series} aria-hidden="true" />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

/** Which AI engines have found the site, and which are still to come. */
export function EngineRoster({ engines, seen }: { engines: EngineView[]; seen: number }) {
  return (
    <figure className="viz-chart">
      <figcaption className="viz-chart__head">
        <div>
          <h3 className="viz-chart__title">AI engines that have found you</h3>
          <p className="viz-chart__sub">
            {seen === 0
              ? 'None yet. New sites are usually found within a couple of weeks.'
              : `${seen} of ${engines.length} have read your pages this month.`}
          </p>
        </div>
      </figcaption>
      <ul className="viz-engines" aria-label="AI engines">
        {engines.map((engine) => (
          <li key={engine.label} className="viz-engine" data-seen={engine.seen ? '' : undefined}>
            <span className="viz-engine__dot" aria-hidden="true" />
            <span className="viz-engine__name">{engine.label}</span>
            <span className="viz-engine__meta">
              {engine.seen ? `${number(engine.count)} ${engine.count === 1 ? 'visit' : 'visits'} · ${engine.lastSeen}` : 'Not yet'}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** One ring, three slices: who read the pages. */
export function Donut({ donut }: { donut: DonutView }) {
  const size = 148;
  const centre = size / 2;
  return (
    <figure className="viz-chart viz-chart--donut">
      <figcaption className="viz-chart__head">
        <div>
          <h3 className="viz-chart__title">Who read your pages</h3>
          <p className="viz-chart__sub">Every page read this month, by who was reading.</p>
        </div>
      </figcaption>
      <div className="viz-donut">
        <div className="viz-donut__ring">
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" style={{ ['--circ' as string]: String(donut.circumference) }}>
            <circle className="viz-donut__track" cx={centre} cy={centre} r={donut.radius} fill="none" strokeWidth="18" />
            {donut.slices.map((slice) => (
              <circle
                key={slice.series}
                className="viz-donut__slice"
                data-series={slice.series}
                cx={centre}
                cy={centre}
                r={donut.radius}
                fill="none"
                strokeWidth="18"
                strokeDasharray={slice.dash}
                strokeDashoffset={slice.offset}
              />
            ))}
          </svg>
          <div className="viz-donut__centre">
            <strong>{number(donut.total)}</strong>
            <span>{donut.total === 1 ? 'page read' : 'page reads'}</span>
          </div>
        </div>
        <ul className="viz-donut__legend" aria-label="Who read your pages">
          {SERIES.map((series) => {
            const slice = donut.slices.find((entry) => entry.series === series.series);
            return (
              <li key={series.key}>
                <span className="viz-swatch" data-series={series.series} aria-hidden="true" />
                <span className="viz-donut__name">{series.label}</span>
                <span className="viz-donut__count">{number(slice?.value ?? 0)}</span>
                <span className="viz-donut__share">{slice ? `${slice.share}%` : '0%'}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}

/** Thirty stacked columns, one a day, three series. */
export function DailyColumns({ daily, days }: { daily: DailyView; days: number }) {
  return (
    <figure className="viz-chart viz-chart--wide">
      <figcaption className="viz-chart__head">
        <div>
          <h3 className="viz-chart__title">Day by day</h3>
          <p className="viz-chart__sub">The last {days} days. Today is still counting.</p>
        </div>
        <Legend />
      </figcaption>

      <div className="viz-plot" role="img" aria-label={`Pages read each day over the last ${days} days, split into people, people sent by an AI assistant, and crawlers.`}>
        <div className="viz-grid" aria-hidden="true">
          {daily.ticks.map((tick) => (
            <div key={tick} className="viz-gridline" style={{ bottom: `${(tick / daily.max) * 100}%` }}>
              <span>{tick}</span>
            </div>
          ))}
        </div>
        <div className="viz-cols" aria-hidden="true">
          {daily.columns.map((column, index) => (
            <div key={column.day} className="viz-col" data-empty={column.total === 0 ? '' : undefined}>
              <div className="viz-col__stack" style={{ ['--i' as string]: String(index) }}>
                {column.heights.visitor > 0 && <div className="viz-seg" data-series="1" style={{ height: `${column.heights.visitor}%` }} />}
                {column.heights.ai > 0 && <div className="viz-seg" data-series="2" style={{ height: `${column.heights.ai}%` }} />}
                {column.heights.crawler > 0 && <div className="viz-seg" data-series="3" style={{ height: `${column.heights.crawler}%` }} />}
              </div>
              <span className="viz-col__tip">{column.tip}</span>
            </div>
          ))}
        </div>
        <div className="viz-xaxis" aria-hidden="true">
          {daily.columns.map((column) => (
            <span key={column.day} className="viz-xlabel">{column.showLabel ? column.label : ''}</span>
          ))}
        </div>
      </div>

      <details className="viz-details">
        <summary>See the numbers</summary>
        <table className="viz-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">People</th>
              <th scope="col">From an AI assistant</th>
              <th scope="col">Crawlers</th>
            </tr>
          </thead>
          <tbody>
            {daily.columns.map((column) => (
              <tr key={column.day}>
                <th scope="row">{column.label}</th>
                <td>{column.visitor}</td>
                <td>{column.ai}</td>
                <td>{column.crawler}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal bars, one hue, the number beside every bar. */
export function Bars({
  title,
  sub,
  bars,
  series,
  unit,
  empty,
  showFamily,
}: {
  title: string;
  sub: string;
  bars: BarView[];
  series: 1 | 2 | 3;
  unit: string;
  empty: string;
  showFamily?: boolean;
}) {
  return (
    <figure className="viz-chart">
      <figcaption className="viz-chart__head">
        <div>
          <h3 className="viz-chart__title">{title}</h3>
          <p className="viz-chart__sub">{sub}</p>
        </div>
      </figcaption>
      {bars.length === 0 ? (
        <p className="viz-none">{empty}</p>
      ) : (
        <ol className="viz-bars" aria-label={title}>
          {bars.map((bar) => (
            <li key={bar.label} className="viz-bar">
              <span className="viz-bar__label">
                <span className="viz-bar__name">{bar.label}</span>
                {showFamily && bar.family && (
                  <span className="viz-bar__family" data-family={bar.family}>{bar.family === 'ai' ? 'AI' : 'Search'}</span>
                )}
              </span>
              <span className="viz-bar__track" aria-hidden="true">
                <span className="viz-bar__fill" data-series={series} style={{ width: `${bar.width}%` }} />
              </span>
              <span className="viz-bar__value">
                {number(bar.count)}
                <span className="viz-sr"> {unit}</span>
              </span>
              {bar.tag && <span className="viz-bar__tag">{bar.tag}</span>}
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
