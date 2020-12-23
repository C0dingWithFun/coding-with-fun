import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { google, youtube_v3 } from 'googleapis';

import { CHANNEL_ID } from '../lib/constants';

// Initializing Admin App
admin.initializeApp();

// Ref to Firestore
const db = admin.firestore();

// YouTube API client
const youtube = google.youtube({
  version: 'v3',
  auth: functions.config().youtube.key,
});

// Fetches details for videos and saves it to firestore
const fetchAndSaveVideoDetails = async (
  client: youtube_v3.Youtube,
  videoIds: string[]
) => {
  await client.videos
    .list({
      part: ['snippet', 'contentDetails', 'statistics'],
      id: videoIds,
    })
    .then(({ data }) => {
      data.items?.forEach((item) => {
        const id = item.id?.toString();
        const publishedDate = new Date(item.snippet?.publishedAt!);
        const publishedAt = admin.firestore.Timestamp.fromDate(publishedDate);
        const doc = {
          title: item.snippet?.title,
          description: item.snippet?.description,
          publishedAt,
          thumbnailURL: item.snippet?.thumbnails?.default?.url,
          tags: item.snippet?.tags,
          stats: {
            viewCount: Number(item.statistics?.viewCount),
            commentCount: Number(item.statistics?.commentCount),
            likeCount: Number(item.statistics?.likeCount),
            dislikeCount: Number(item.statistics?.dislikeCount),
          },
        };

        // Saving doc to firestore
        db.collection('videos')
          .doc(id!)
          .set(doc)
          .then(() => {
            console.log(`Successfully added Video: ${id} to the firestore 🎉`);
          })
          .catch(console.error);
      });
    })
    .catch(console.error);
};

// Gets all videos for channel, fetches data and stores it to firestore
const getSearchResults = async (
  client: youtube_v3.Youtube,
  nextPageToken?: string,
  lastPublishedVideoDate?: FirebaseFirestore.Timestamp
) => {
  await client.search
    .list({
      part: ['id'],
      maxResults: 10,
      order: 'date',
      type: ['video'],
      channelId: CHANNEL_ID,
      pageToken: nextPageToken,
      publishedAfter: lastPublishedVideoDate?.toDate().toString(),
    })
    .then(async (response) => {
      const videoIds: string[] = [];
      response.data.items?.forEach((item) => {
        if (item.id?.videoId) videoIds.push(item.id.videoId);
      });

      console.info('Fetching Video Details and saving it to firestore');
      fetchAndSaveVideoDetails(client, videoIds).catch(console.error);
      console.info('Successfully Fetched and Saved Video Details');

      if (response.data.nextPageToken) {
        console.info('fetching next page...');
        getSearchResults(client, response.data?.nextPageToken).catch(
          console.error
        );
      }
    })
    .catch(console.error);
};

export const youtubeVideoUpdater = functions.pubsub
  .schedule('every day 00:00')
  .onRun(async (context) => {
    console.info('Running youtubeVideoUpdater');

    db.collection('videos')
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get()
      .then(async (snapshot) => {
        if (snapshot.empty) {
          console.info(
            'No previos videos found, fetching all the videos from channel!'
          );
          // Fetching All videos
          await getSearchResults(youtube);
        } else {
          const doc = snapshot.docs[0];
          const data = doc.data();
          const lastPublishedAt = data.publishedAt as FirebaseFirestore.Timestamp;
          console.info(
            `Found video last published on: ${lastPublishedAt.toDate()}, fetching all videos published after that time...`
          );
          console.log('data: ', data);
          // fetching Results after last published Date
          await getSearchResults(youtube, undefined, lastPublishedAt);
        }
      })
      .catch(console.error);

    // fetch last date from database - 3
    // fetch videos from YouTube API - 1 (figure out which fields we need)
    // Handle multiple page case (STRETCH FEATURE but IMPORTANT, you will only need this when you are re-fetching data for some reason :()) - 4
    // add it to firestore - 2
    //   log it to console as well! - 2.1
    // Setup Eslint with AirBnb and Pritteir!
  });
