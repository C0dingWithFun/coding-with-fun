import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';

import { CHANNEL_ID } from '../lib/constants';

if (!admin.apps.length) {
  admin.initializeApp({});
}

// Ref to Firestore
const db = admin.firestore();

// YouTube API client
const youtube = google.youtube({
  version: 'v3',
  auth: functions.config().youtube.key,
});

// Fetches details for videos and saves it to firestore
const fetchAndSavePlaylistDetails = async (playlistId: string, doc: any) => {
  await youtube.playlistItems
    .list({
      part: ['contentDetails'],
      playlistId,
      maxResults: 50,
    })
    .then(({ data }) => {
      // TODO: Handle Case if playlist has more than 50 videos in it!!!
      const videosIds: admin.firestore.DocumentReference<any>[] = [];
      data.items?.forEach((item) => {
        console.log(item);
        videosIds.push(db.doc('videos/' + item.contentDetails?.videoId!));
      });
      // adding videos Ids to the doc
      doc.videos = videosIds;
      // Saving doc to firestore
      db.collection('playlists')
        .doc(playlistId)
        .set(doc, { merge: true })
        .then(() => {
          console.log(
            `Successfully added Playlist: ${playlistId} to the firestore 🎉`
          );
        })
        .catch(console.error);
    })
    .catch(console.error);
};

// Gets all videos for channel, fetches data and stores it to firestore
const getPlaylists = async (nextPageToken?: string) => {
  await youtube.playlists
    .list({
      part: ['snippet', 'contentDetails'],
      maxResults: 50,
      channelId: CHANNEL_ID,
      pageToken: nextPageToken,
    })
    .then(async (response) => {
      if (!response.data.items?.length) {
        console.info('No Playlists Found! Exiting the function now...');
        return;
      }
      response.data.items?.forEach((item) => {
        const { id } = item;
        const publishedDate = new Date(item.snippet?.publishedAt!);
        const publishedAt = admin.firestore.Timestamp.fromDate(publishedDate);
        const doc = {
          title: item.snippet?.title,
          description: item.snippet?.description,
          publishedAt,
          thumbnailURL: item.snippet?.thumbnails?.default?.url,
          videosCount: item.contentDetails?.itemCount,
          // totalVideos,
        };
        console.info('Fetching Playlist Details and saving it to firestore');
        fetchAndSavePlaylistDetails(id!, doc).catch(console.error);
        console.info('Successfully Fetched and Saved PLaylist Details');
      });

      if (response.data.nextPageToken) {
        console.info('fetching next page...');
        getPlaylists(response.data?.nextPageToken).catch(console.error);
      }
    })
    .catch(console.error);
};

export const youtubePlaylistUpdater = functions.pubsub
  .schedule('every day 00:10')
  .onRun(async () => {
    console.info('Running youtubePlaylistUpdater');
    await getPlaylists().catch(console.error);
  });
