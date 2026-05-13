import { StatsEvent } from 'webrtc-stats-gatherer';
import { FlatObject, InsightAction } from './types/interfaces';
export declare function formatStatsEvent(event: StatsEvent, extraDetails?: FlatObject): InsightAction<{
    _eventType: string;
} & FlatObject>;
export declare function deepFlatten(obj: any, prefix?: string): any;
