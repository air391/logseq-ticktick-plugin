# Installing a CI build in Logseq

The `Package Plugin` workflow builds the plugin and uploads `logseq-ticktick-plugin.zip` as a GitHub Actions artifact.

For manual UI smoke testing:

1. Open the latest successful `Package Plugin` workflow run.
2. Download the `logseq-ticktick-plugin` artifact.
3. Extract the ZIP.
4. In Logseq, enable developer mode and choose **Load unpacked plugin**.
5. Select the extracted `logseq-ticktick-plugin` directory.
6. In plugin settings, choose `dida` and paste a Dida access token.

API behavior is covered separately by GitHub Actions. Manual testing should focus on installation, settings rendering, command discoverability, and overall interaction behavior.
