import React from 'react';
import type { HlToken } from '../../../shared/transcript/highlight';

const TOKEN_CLASS = {
  key: 'tok-key',
  str: 'tok-str',
  num: 'tok-num',
  com: 'tok-com',
  fn: 'tok-fn',
  add: 'tok-add',
  del: 'tok-del'
} as const;

/** Token spans for highlighted source. Class names match `src/index.css`. */
export function HighlightedCode({ tokens }: { tokens: HlToken[] }) {
  return (
    <>
      {tokens.map((token, index) =>
        token.cls
          ? <span key={index} className={TOKEN_CLASS[token.cls]}>{token.text}</span>
          : <React.Fragment key={index}>{token.text}</React.Fragment>
      )}
    </>
  );
}
