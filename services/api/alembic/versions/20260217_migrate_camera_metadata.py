"""Migrate camera fixed metadata columns to JSON

Simplifies camera registration to IMEI + name + flexible metadata.
Migrates 9 fixed columns (serial_number, box, order, scanned_date, firmware,
remark, has_sim, imsi, iccid) into a single metadata JSON column.

Revision ID: 20260217_camera_metadata
Revises: 20260217_add_project_docs
Create Date: 2026-02-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260217_camera_metadata'
down_revision = '20260217_add_project_docs'
branch_labels = None
depends_on = None

# Columns to migrate: (old_column_name, metadata_key, is_boolean, is_date)
COLUMNS = [
    ('serial_number', 'Serial number', False, False),
    ('box',           'Box',           False, False),
    ('order',         '"order"',       False, False),  # order is reserved word
    ('scanned_date',  'Scanned date',  False, True),
    ('firmware',      'Firmware',       False, False),
    ('remark',        'Remark',         False, False),
    ('has_sim',       'Has SIM',        True,  False),
    ('imsi',          'IMSI',           False, False),
    ('iccid',         'ICCID',          False, False),
]


def upgrade():
    # 1. Add metadata column
    op.add_column('cameras', sa.Column('metadata', sa.JSON(), nullable=True))

    # 2. Migrate data from fixed columns to metadata JSON
    # Use raw SQL to build JSON from existing columns
    conn = op.get_bind()
    cameras = conn.execute(sa.text(
        'SELECT id, serial_number, box, "order", scanned_date, firmware, '
        'remark, has_sim, imsi, iccid FROM cameras'
    )).fetchall()

    for cam in cameras:
        cam_id = cam[0]
        metadata = {}

        # serial_number
        if cam[1]:
            metadata['Serial number'] = str(cam[1])
        # box
        if cam[2]:
            metadata['Box'] = str(cam[2])
        # order
        if cam[3]:
            metadata['Order'] = str(cam[3])
        # scanned_date
        if cam[4]:
            metadata['Scanned date'] = cam[4].strftime('%Y-%m-%d') if hasattr(cam[4], 'strftime') else str(cam[4])
        # firmware
        if cam[5]:
            metadata['Firmware'] = str(cam[5])
        # remark
        if cam[6]:
            metadata['Remark'] = str(cam[6])
        # has_sim
        if cam[7] is not None:
            metadata['Has SIM'] = 'Yes' if cam[7] else 'No'
        # imsi
        if cam[8]:
            metadata['IMSI'] = str(cam[8])
        # iccid
        if cam[9]:
            metadata['ICCID'] = str(cam[9])

        if metadata:
            import json
            conn.execute(
                sa.text('UPDATE cameras SET metadata = CAST(:meta AS json) WHERE id = :id'),
                {'meta': json.dumps(metadata), 'id': cam_id}
            )

    # 3. Drop indexes first
    op.drop_index('ix_cameras_serial_number', table_name='cameras', if_exists=True)
    op.drop_index('ix_cameras_imsi', table_name='cameras', if_exists=True)
    op.drop_index('ix_cameras_iccid', table_name='cameras', if_exists=True)

    # Drop unique constraint on serial_number if it exists
    # PostgreSQL auto-creates a unique index for unique columns
    conn.execute(sa.text(
        "ALTER TABLE cameras DROP CONSTRAINT IF EXISTS cameras_serial_number_key"
    ))

    # 4. Drop columns
    op.drop_column('cameras', 'serial_number')
    op.drop_column('cameras', 'box')
    op.drop_column('cameras', 'order')
    op.drop_column('cameras', 'scanned_date')
    op.drop_column('cameras', 'firmware')
    op.drop_column('cameras', 'remark')
    op.drop_column('cameras', 'has_sim')
    op.drop_column('cameras', 'imsi')
    op.drop_column('cameras', 'iccid')


def downgrade():
    # 1. Re-add the 9 columns
    op.add_column('cameras', sa.Column('serial_number', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('box', sa.String(100), nullable=True))
    op.add_column('cameras', sa.Column('order', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('scanned_date', sa.Date(), nullable=True))
    op.add_column('cameras', sa.Column('firmware', sa.String(100), nullable=True))
    op.add_column('cameras', sa.Column('remark', sa.Text(), nullable=True))
    op.add_column('cameras', sa.Column('has_sim', sa.Boolean(), nullable=True))
    op.add_column('cameras', sa.Column('imsi', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('iccid', sa.String(50), nullable=True))

    # 2. Migrate data back from metadata JSON
    conn = op.get_bind()
    cameras = conn.execute(sa.text('SELECT id, metadata FROM cameras WHERE metadata IS NOT NULL')).fetchall()

    from datetime import datetime

    for cam in cameras:
        cam_id = cam[0]
        meta = cam[1]
        if not meta:
            continue

        updates = []
        params = {'id': cam_id}

        if 'Serial number' in meta:
            updates.append('serial_number = :sn')
            params['sn'] = meta['Serial number']
        if 'Box' in meta:
            updates.append('box = :box')
            params['box'] = meta['Box']
        if 'Order' in meta:
            updates.append('"order" = :ord')
            params['ord'] = meta['Order']
        if 'Scanned date' in meta:
            updates.append('scanned_date = :sd')
            try:
                params['sd'] = datetime.strptime(meta['Scanned date'], '%Y-%m-%d').date()
            except ValueError:
                params['sd'] = None
        if 'Firmware' in meta:
            updates.append('firmware = :fw')
            params['fw'] = meta['Firmware']
        if 'Remark' in meta:
            updates.append('remark = :rem')
            params['rem'] = meta['Remark']
        if 'Has SIM' in meta:
            updates.append('has_sim = :sim')
            params['sim'] = meta['Has SIM'] == 'Yes'
        if 'IMSI' in meta:
            updates.append('imsi = :imsi')
            params['imsi'] = meta['IMSI']
        if 'ICCID' in meta:
            updates.append('iccid = :iccid')
            params['iccid'] = meta['ICCID']

        if updates:
            conn.execute(
                sa.text(f'UPDATE cameras SET {", ".join(updates)} WHERE id = :id'),
                params,
            )

    # 3. Re-create indexes
    op.create_index('ix_cameras_serial_number', 'cameras', ['serial_number'], unique=True)
    op.create_index('ix_cameras_imsi', 'cameras', ['imsi'])
    op.create_index('ix_cameras_iccid', 'cameras', ['iccid'])

    # 4. Drop metadata column
    op.drop_column('cameras', 'metadata')
