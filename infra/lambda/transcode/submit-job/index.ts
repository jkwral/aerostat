import type { EventBridgeEvent } from 'aws-lambda';
import { CreateJobCommand, DescribeEndpointsCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';

const MEDIACONVERT_ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN ?? '';

// Mid-point of the ~1.2-1.8 Mbps range from DECISIONS.md.
const VIDEO_BITRATE_BPS = 1_500_000;
const PROXY_HEIGHT_PX = 480;

interface S3ObjectCreatedDetail {
  bucket: { name: string };
  object: { key: string };
}

let cachedClient: MediaConvertClient | undefined;

// MediaConvert requires calling the account/region-specific endpoint (not
// the generic regional one) for every other API call. Resolve it once per
// warm Lambda execution environment.
async function getMediaConvertClient(): Promise<MediaConvertClient> {
  if (cachedClient) {
    return cachedClient;
  }
  const bootstrapClient = new MediaConvertClient({});
  const { Endpoints } = await bootstrapClient.send(new DescribeEndpointsCommand({}));
  const endpointUrl = Endpoints?.[0]?.Url;
  if (!endpointUrl) {
    throw new Error('MediaConvert DescribeEndpoints did not return an account endpoint.');
  }
  cachedClient = new MediaConvertClient({ endpoint: endpointUrl });
  return cachedClient;
}

function basenameWithoutExtension(key: string): string {
  const basename = key.split('/').pop() ?? key;
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(0, dot) : basename;
}

export const handler = async (
  event: EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>,
): Promise<void> => {
  const { bucket, object } = event.detail;
  const sourceKey = object.key;
  const outputBasename = basenameWithoutExtension(sourceKey);

  const client = await getMediaConvertClient();

  await client.send(
    new CreateJobCommand({
      Role: MEDIACONVERT_ROLE_ARN,
      // Lets the Phase 4 job-state-change handler correlate a COMPLETE/ERROR
      // event back to the original input/ object without a separate lookup.
      UserMetadata: { sourceKey },
      Settings: {
        Inputs: [
          {
            FileInput: `s3://${bucket.name}/${sourceKey}`,
            AudioSelectors: {
              'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
            },
          },
        ],
        OutputGroups: [
          {
            Name: 'Proxy MP4',
            OutputGroupSettings: {
              Type: 'FILE_GROUP_SETTINGS',
              FileGroupSettings: {
                Destination: `s3://${bucket.name}/proxy/${outputBasename}`,
              },
            },
            Outputs: [
              {
                ContainerSettings: { Container: 'MP4' },
                VideoDescription: {
                  // Height only, Width left unset: MediaConvert scales width
                  // to preserve the source aspect ratio (source is 1080i,
                  // arbitrary aspect ratio not assumed here).
                  Height: PROXY_HEIGHT_PX,
                  ScalingBehavior: 'DEFAULT',
                  VideoPreprocessors: {
                    // Source is 1080i; deinterlacing is mandatory (see
                    // DECISIONS.md) to avoid combing artifacts. ADAPTIVE mode
                    // deinterlaces only the frames that are actually
                    // interlaced.
                    Deinterlacer: {
                      Algorithm: 'INTERPOLATE',
                      Mode: 'ADAPTIVE',
                      Control: 'NORMAL',
                    },
                  },
                  CodecSettings: {
                    Codec: 'H_264',
                    H264Settings: {
                      RateControlMode: 'CBR',
                      Bitrate: VIDEO_BITRATE_BPS,
                      CodecProfile: 'MAIN',
                      CodecLevel: 'AUTO',
                    },
                  },
                },
                AudioDescriptions: [
                  {
                    AudioSourceName: 'Audio Selector 1',
                    CodecSettings: {
                      Codec: 'AAC',
                      AacSettings: {
                        Bitrate: 96_000,
                        SampleRate: 48_000,
                        CodingMode: 'CODING_MODE_2_0',
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
};
