import type { SinHistoryResult } from '../src/history-repository';
import type { SinHistoryResult as AppSinHistoryResult } from '../src/app';

type ParsedResult = Extract<SinHistoryResult, { mode: 'parsed' }>;
type NonParsedResult = Exclude<SinHistoryResult, ParsedResult>;
type RequiredProperty<T, K extends keyof T> = undefined extends T[K] ? false : true;
type ParsedHasRequiredSummary = RequiredProperty<ParsedResult, 'summary'>;
type ParsedHasRequiredTimeline = RequiredProperty<ParsedResult, 'timeline'>;
type ParsedHasRequiredDocumentIdentity = RequiredProperty<ParsedResult, 'documentIdentity'>;
type OtherVariantsMayOmitSummary = NonParsedResult extends { summary: never } ? false : true;

describe('SinHistoryResult type contract', () => {
  it('requires the parsed payload fields and keeps the other variants distinct', () => {
    expectTypeOf<ParsedResult['mode']>().toEqualTypeOf<'parsed'>();
    expectTypeOf<ParsedHasRequiredSummary>().toEqualTypeOf<true>();
    expectTypeOf<ParsedHasRequiredTimeline>().toEqualTypeOf<true>();
    expectTypeOf<ParsedHasRequiredDocumentIdentity>().toEqualTypeOf<true>();
    expectTypeOf<OtherVariantsMayOmitSummary>().toEqualTypeOf<true>();
    expectTypeOf<AppSinHistoryResult>().toEqualTypeOf<SinHistoryResult>();
  });
});
