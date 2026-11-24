import { S3Client } from '@aws-sdk/client-s3';

// requestChecksumCalculation: 'WHEN_REQUIRED' stops newer SDK versions from adding a
// checksum to presigned PUT URLs, which would make browser uploads fail.
export const s3 = new S3Client({
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const BUCKET = process.env.FILES_BUCKET;
export const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_MB || 25) * 1024 * 1024;
export const URL_EXPIRY_SECONDS = 300;
