'use strict';

export interface HiveScrobblePayload {
	app: string;
	artist: string;
	title: string;
	album?: string;
	timestamp: string;
	duration?: string;
	percent_played?: number;
	platform?: string;
	url?: string;
}
