'use client';

import { useState } from 'react';
import { MediaStage } from './media-stage';
import type { PublicCreation } from './public-creation';

/** The results of a shared creation, as large as the screen allows (a client island: it holds the chosen result). */
export function ShareMedia({ creation }: { creation: PublicCreation }) {
  const [index, setIndex] = useState(0);
  return (
    <MediaStage
      outputs={creation.outputs}
      kind={creation.kind}
      prompt={creation.prompt}
      index={index}
      onIndexChange={setIndex}
    />
  );
}
