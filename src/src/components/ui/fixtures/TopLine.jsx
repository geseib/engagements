import React from 'react';
import TopLine from '../TopLine';

/**
 * Gallery fixture for unit L7 (gallery:ui-top-line). Dusk, as the wall and the
 * stage are: the full line, a line with only a right side, and the same line
 * at a wall-like size. The 2px Call rule comes from the display profile
 * (:root.d-call), not from the component, so it shows when the gallery runs
 * under Call. Sample data only: no network. Frames use the gallery's
 * .sg-sheet class (components/SkinGallery.css).
 */
export default function TopLineFixture() {
  return (
    <div className="sg-sheet" data-theme="dark">
      <TopLine
        left={<><b>Strategy offsite</b> · Round 5 of 8</>}
        right="Answering"
      />
      <br />
      <TopLine right={<><b>31</b> answered</>} />
      <br />
      <TopLine
        style={{ '--ui-top-line-size': '21px' }}
        left={<><b>Q3 planning</b> · Question 2 of 6</>}
        right="Voting"
      />
    </div>
  );
}
