-- The stratified image sample used by the update test.
--
-- One definition, read by two scripts: restore.sh --db-only fetches these
-- objects out of the backup, and verify-server.sh then asks the API to serve
-- them. They must agree on which images, so this is deterministic on purpose:
-- no RANDOM(), every branch ordered by id, so the same database always yields
-- the same sample and a failure can be reproduced.
--
-- Stratified rather than random because a camera trap set is mostly
-- near-duplicate empty frames from a few cameras. A hundred random images
-- would be a hundred copies of one code path. These fifteen-ish rows each
-- reach a different one.
--
-- Columns: reason, uuid, storage_path, thumbnail_path.
-- thumbnail_path is nullable, callers must cope with an empty string.

WITH person AS (
    SELECT 'person-box' AS reason, i.*
    FROM images i
    WHERE EXISTS (SELECT 1 FROM detections d WHERE d.image_id = i.id AND d.category = 'person')
    ORDER BY i.id LIMIT 2
),
vehicle AS (
    SELECT 'vehicle-box' AS reason, i.*
    FROM images i
    WHERE EXISTS (SELECT 1 FROM detections d WHERE d.image_id = i.id AND d.category = 'vehicle')
    ORDER BY i.id LIMIT 2
),
-- The fast path: nothing to blur, so the bytes should come back untouched.
plain AS (
    SELECT 'no-person-or-vehicle' AS reason, i.*
    FROM images i
    WHERE i.status = 'classified'
      AND NOT EXISTS (
        SELECT 1 FROM detections d
        WHERE d.image_id = i.id AND d.category IN ('person', 'vehicle')
      )
    ORDER BY i.id LIMIT 2
),
-- Not classified means the detector never ran, so the whole frame is blurred
-- rather than the boxes. Different code, and the reason it exists.
pending AS (
    SELECT 'status-pending' AS reason, i.* FROM images i
    WHERE i.status = 'pending' ORDER BY i.id LIMIT 1
),
failed AS (
    SELECT 'status-failed' AS reason, i.* FROM images i
    WHERE i.status = 'failed' ORDER BY i.id LIMIT 1
),
-- SD-card imports, which reach storage by a different route than FTPS.
bulk AS (
    SELECT 'origin-bulk' AS reason, i.* FROM images i
    WHERE i.origin = 'bulk' ORDER BY i.id LIMIT 1
),
-- One per camera stands in for one per camera model: profiles differ per
-- model, and so do the JPEGs they produce, EXIF included.
per_camera AS (
    -- Only the four columns the caller needs, so adding a column to images
    -- cannot break this.
    SELECT reason, id, uuid, storage_path, thumbnail_path
    FROM (
        SELECT 'per-camera' AS reason, i.id, i.uuid, i.storage_path, i.thumbnail_path,
               ROW_NUMBER() OVER (PARTITION BY i.camera_id ORDER BY i.id) AS rn,
               DENSE_RANK() OVER (ORDER BY i.camera_id) AS cam_rank
        FROM images i
    ) ranked
    WHERE rn = 1 AND cam_rank <= 6
),
-- The ends of the range, where odd files tend to live: the first images a
-- deployment ever sent, and the most recent firmware's output.
oldest AS (
    SELECT 'oldest' AS reason, i.* FROM images i ORDER BY i.captured_at, i.id LIMIT 1
),
newest AS (
    SELECT 'newest' AS reason, i.* FROM images i ORDER BY i.captured_at DESC, i.id DESC LIMIT 1
),
combined AS (
    SELECT reason, id, uuid, storage_path, thumbnail_path FROM person
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM vehicle
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM plain
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM pending
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM failed
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM bulk
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM per_camera
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM oldest
    UNION ALL SELECT reason, id, uuid, storage_path, thumbnail_path FROM newest
)
-- An image can satisfy several strata, so keep it once. The tie-break prefers
-- the more specific reason: a file that is both the first from its camera and
-- the one with a person box is reported as person-box, because that is what it
-- is covering. Ordering alphabetically instead hid person coverage behind
-- per-camera and made the output understate what was tested.
SELECT DISTINCT ON (uuid) reason, uuid, storage_path, COALESCE(thumbnail_path, '')
FROM combined
ORDER BY uuid, CASE reason
    WHEN 'status-pending'       THEN 1
    WHEN 'status-failed'        THEN 2
    WHEN 'person-box'           THEN 3
    WHEN 'vehicle-box'          THEN 4
    WHEN 'origin-bulk'          THEN 5
    WHEN 'oldest'               THEN 6
    WHEN 'newest'               THEN 7
    WHEN 'no-person-or-vehicle' THEN 8
    ELSE 9
END;
