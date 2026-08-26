import type { ReactElement } from 'react';

import {
  climateMonths,
  referenceRows,
  SEASON_LABEL,
  type ReferenceFacts,
} from '../../lib/content/reference';

/**
 * The facts half of a destination page.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE ENTRY'S OWN FACT LIST. That list is built
 * from the fields a client declared on their collection, so it says whatever they
 * decided to type. This is the corpus talking: researched, two-source verified,
 * and refreshed centrally, so a visa rule that changes changes here without
 * anybody opening the editor. See lib/content/reference.ts for the split.
 *
 * NO SCRIPT, per clause 2 of the rule at the top of lib/content/blocks.ts. Every
 * number is in the server-rendered HTML. The chart is a real table with real
 * values in it, and the bars are a CSS height driven by one custom property, so
 * with the stylesheet blocked a reader still gets twelve months of temperatures
 * and rainfall in a table they can read.
 *
 * THE CHART IS A TABLE BECAUSE IT IS TABULAR. Twelve months against two measures
 * is exactly what a table is for, and it means a screen reader announces "August,
 * 27 degrees, 5 millimetres" rather than reading out a row of divs. The visual
 * chart is that same table restyled, not a second rendering of the same numbers
 * that could disagree with it.
 */
export function DestinationPanel({ facts }: { facts: ReferenceFacts }): ReactElement | null {
  const rows = referenceRows(facts);
  const months = facts.climate ? climateMonths(facts.climate) : [];

  // Nothing worth drawing. A corpus record with no facts and no climate is a stub,
  // and an empty bordered panel reads as a fault rather than as an absence.
  if (rows.length === 0 && months.length === 0 && !facts.bestFor?.length) return null;

  return (
    <section className="tgs-dest" aria-label="About this destination">
      {facts.bestFor && facts.bestFor.length > 0 && (
        /*
         * WHO IT SUITS, first, because it is the fastest way for a reader to
         * decide the page is about their holiday. A list rather than loose spans
         * so it is announced as a list of five things rather than one run-on line.
         */
        <ul className="tgs-dest__tags">
          {facts.bestFor.map((tag) => (
            <li className="tgs-dest__tag" key={tag}>
              {tag}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <dl className="tgs-dest__facts">
          {rows.map((row) => (
            /*
             * A LONG ONE IS A NOTE, NOT A NUMBER. The corpus is not consistent
             * about which it holds: Greece's flight time is "3h 30m", Mexico
             * City's is a sentence naming both airports. Both are correct and
             * the sentence is the more useful of the two, so it is set as prose
             * and allowed to span the grid rather than squeezed into a cell at
             * heading size.
             */
            <div className="tgs-dest__fact" key={row.key} data-long={row.long ? '' : undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {months.length > 0 && (
        <figure className="tgs-dest__climate">
          <figcaption className="tgs-dest__climate-title">The year, month by month</figcaption>

          <table className="tgs-dest__chart">
            <caption className="tgs-dest__chart-caption">
              Average daytime high and monthly rainfall, with the months that suit a visit best.
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Daytime high</th>
                <th scope="col">Rainfall</th>
                <th scope="col">Season</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr
                  className="tgs-dest__month"
                  key={month.label}
                  data-season={month.season}
                  /*
                   * The bar's height, as a share of the warmest month. An inline
                   * custom property rather than a class, because the value is a
                   * number per month and twelve classes would only be able to say
                   * twelve heights. climateMonths clamps it to 8-100 before it
                   * reaches here, so nothing unbounded goes into the attribute.
                   */
                  style={{ '--tgs-dest-bar': `${month.height}%` } as React.CSSProperties}
                >
                  <th scope="row" className="tgs-dest__month-name">
                    {month.label}
                  </th>
                  <td className="tgs-dest__temp">
                    <span className="tgs-dest__bar" aria-hidden="true" />
                    <span className="tgs-dest__value">{month.temp}&deg;</span>
                  </td>
                  <td className="tgs-dest__rain">{month.rainfall}mm</td>
                  <td className="tgs-dest__season">{SEASON_LABEL[month.season]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/*
            The key. Hidden from a screen reader because the Season column above
            already says the same thing in words for every month, and reading a
            legend as well would be saying it twice.
          */}
          <ul className="tgs-dest__key" aria-hidden="true">
            {(['best', 'shoulder', 'off'] as const).map((season) => (
              <li className="tgs-dest__key-item" data-season={season} key={season}>
                {SEASON_LABEL[season]}
              </li>
            ))}
          </ul>
        </figure>
      )}
    </section>
  );
}
