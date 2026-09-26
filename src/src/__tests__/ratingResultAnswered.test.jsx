/**
 * RatingResult states "N answered" beside its top-two share — Task 8 of the
 * 2026-09-26 feature sweep. The brief's own words for the stage walk-through:
 * "the mean, 'N answered · X% said 4 or 5', and the distribution with end
 * labels." On the console the count already sits in KindResult's card header
 * ("38 answered"), but SurveyWalkthrough.jsx mounts RatingResult directly,
 * with no such header — so the merged line has to live in the ONE shared
 * component both surfaces render, not a second copy of it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import RatingResult from '../components/survey/results/RatingResult';

const ratingQ = {
  result: { kind: 'rating', scale: '1-5', n: 38, counts: [1, 2, 6, 15, 14], mean: 4.03, topTwo: 76 },
};

const noTopTwoQ = {
  result: { kind: 'rating', scale: '1-5', n: 12, counts: [1, 2, 3, 3, 3], mean: 3.4, topTwo: null },
};

describe('RatingResult: "N answered" beside the top-two share', () => {
  it('merges the answered count with the top-two share on one line', () => {
    render(<RatingResult question={ratingQ} />);
    expect(screen.getByText('38 answers · 76% said 4 or 5')).toBeInTheDocument();
  });

  it('still states the count when there is no top-two figure', () => {
    render(<RatingResult question={noTopTwoQ} />);
    expect(screen.getByText('12 answers')).toBeInTheDocument();
  });
});
