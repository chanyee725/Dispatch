// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
import { isPointAttachment, isPointEndpoint } from './contract.ts';
import type { FaceTerminalAttachment } from './contract.ts';
import { faceCrossSpan } from './geometry.ts';
import { midpoint } from '../../rangeUtils.ts';
import type { RoutingQualityCost } from './qualityCost.ts';
import {
  addRepairEvent,
  replaceRepairRoutes,
  type RepairContext,
  type RepairProposal,
} from './repairProposal.ts';
import type { Route } from './route.ts';
import type { CorridorWorld } from './world.ts';

const EPSILON = 1e-6;

/** Try center-containing attachments without changing endpoint faces or authored ports. */
export function collectEndpointProposals(context: RepairContext): RepairProposal[] {
  const demandedRoutes = new Map<number, RoutingQualityCost>();
  for (const event of context.batch.quality.events) {
    if (
      event.kind === 'terminal-direction' ||
      (context.mode === 'quality' &&
        (event.kind === 'near-face-turn' || event.kind === 'face-fan-symmetry'))
    ) {
      for (const routeIndex of event.routeIndexes) {
        if (!context.protectedRouteIndexes.has(routeIndex)) {
          const cost = demandedRoutes.get(routeIndex) ?? { invalid: 0, cap: 0, scalar: 0 };
          addRepairEvent(cost, event);
          demandedRoutes.set(routeIndex, cost);
        }
      }
    }
  }

  const proposals: RepairProposal[] = [];
  for (const [routeIndex, cost] of demandedRoutes) {
    const hiddenAttachments = offCenterAttachmentIndexes(
      context.world,
      context.topologies[routeIndex],
    );
    if (hiddenAttachments.length === 0) {
      continue;
    }
    const routeIndexes = [routeIndex];
    proposals.push({
      kind: 'endpoint',
      key: `endpoint:${routeIndex}`,
      routeIndexes,
      cost,
      build: () => {
        const search = context.search.search(context.requests[routeIndex], {
          hiddenAttachmentIndexes: new Set(hiddenAttachments),
          preferCenteredTerminalAttachments: false,
        });
        if (search.fallback) {
          return undefined;
        }
        return replaceRepairRoutes(context, new Map([[routeIndex, search.route]]));
      },
    });
  }
  return proposals;
}

function offCenterAttachmentIndexes(world: CorridorWorld, route: Route): number[] {
  const hidden: number[] = [];
  for (const endpoint of [route.from, route.to]) {
    if (isPointEndpoint(endpoint) || endpoint.authoredTrack !== undefined) {
      continue;
    }
    const center =
      endpoint.preferredTrack ??
      midpoint(faceCrossSpan(world.entities[endpoint.entityIndex], endpoint.face));
    const attachments = world.indexer
      .attachmentsForEndpoint(endpoint)
      .map((attachmentIndex) => world.indexer.attachments[attachmentIndex])
      .filter((attachment): attachment is FaceTerminalAttachment => !isPointAttachment(attachment));
    if (
      !attachments.some(
        (attachment) =>
          center >= attachment.faceSpan[0] - EPSILON && center <= attachment.faceSpan[1] + EPSILON,
      )
    ) {
      continue;
    }
    for (const attachment of attachments) {
      if (center < attachment.faceSpan[0] - EPSILON || center > attachment.faceSpan[1] + EPSILON) {
        hidden.push(attachment.index);
      }
    }
  }
  return hidden;
}
