# Stillframe

Build a minimal web app for dance practice.

MVP only:

1. Upload a dance video.

2. Display video player.

3. Use MediaPipe Pose Landmarker to analyze the video frame by frame.

4. Detect key poses automatically by finding moments where body landmark movement becomes very low.

5. Generate pose thumbnails with timestamps.

6. Show thumbnails in a timeline below the video.

7. Clicking a thumbnail jumps the video to that timestamp.

8. User can manually add current frame as a pose.

9. User can delete wrong pose thumbnails.

10. User can adjust detection sensitivity.

Use Next.js, React, TypeScript.

Keep UI clean and minimal  good taste like the little white lies.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://framedance.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4d3c15cc-cfda-4e5f-b81b-9b6fcc9b6a2a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
