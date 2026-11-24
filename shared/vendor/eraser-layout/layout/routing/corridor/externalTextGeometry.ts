// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
import type { LayoutEntity } from '../../types.ts';
import { touchExternalTextRangeToEntityClippedToBodyFace } from '../textPlacements.ts';

export interface ExternalTextEntity extends LayoutEntity {
  readonly entityIndex: number;
}

/** Routing-owned caption blockers, in owner order; body and terminal geometry stay separate. */
export function buildExternalTextEntities(entities: readonly LayoutEntity[]): ExternalTextEntity[] {
  const result: ExternalTextEntity[] = [];
  for (let entityIndex = 0; entityIndex < entities.length; entityIndex += 1) {
    const entity = entities[entityIndex];
    const rect = touchExternalTextRangeToEntityClippedToBodyFace(entity);
    if (rect) {
      result.push({ ...entity, ...rect, textPlacement: undefined, entityIndex });
    }
  }
  return result;
}
