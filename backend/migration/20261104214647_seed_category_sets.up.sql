-- Migration Up
-- Description: Seed the launch regions' default category sets (BR-CAT-01,
-- BR-CAT-07), as listed in docs/requirements/business-requirements.md under
-- "Default category sets". Each set is complete on its own.

BEGIN;

INSERT INTO category_sets (region, position, name_en, name_ja, name_fr, country_codes) VALUES
    ('jp', 1, 'Japan', '日本', 'Japon', '{JP}'),
    ('eu', 2, 'European Union', '欧州連合（EU）', 'Union européenne',
     '{AT,BE,BG,CY,CZ,DE,DK,EE,ES,FI,FR,GR,HR,HU,IE,IT,LT,LU,LV,MT,NL,PL,PT,RO,SE,SI,SK}'),
    ('us', 3, 'United States', 'アメリカ合衆国', 'États-Unis', '{US}'),
    ('global', 4, 'Other', 'その他', 'Autre', '{}');

INSERT INTO category_set_items (region, key, position, emoji, name_en, name_ja, name_fr) VALUES
    ('global', 'eat_out',   1, '🍔', 'Eat Out',   '外食',         'Restaurant'),
    ('global', 'grocery',   2, '🛒', 'Grocery',   '食料品',       'Courses'),
    ('global', 'transport', 3, '🚌', 'Transport', '交通',         'Transports'),
    ('global', 'friends',   4, '🤩', 'Friends',   '交際',         'Amis'),
    ('global', 'leisure',   5, '🏔️', 'Leisure',   'レジャー',     'Loisirs'),
    ('global', 'medical',   6, '💊', 'Medical',   '医療',         'Santé'),
    ('global', 'beauty',    7, '🧴', 'Beauty',    '美容',         'Beauté'),
    ('global', 'fashion',   8, '👕', 'Fashion',   'ファッション', 'Mode'),

    ('jp', 'eat_out', 1, '🍔', 'Eat Out',  '外食',         'Restaurant'),
    ('jp', 'konbini', 2, '🏪', 'Konbini',  'コンビニ',     'Konbini'),
    ('jp', 'suica',   3, '🚇', 'Suica',    'Suica',        'Suica'),
    ('jp', 'grocery', 4, '🛒', 'Grocery',  '食料品',       'Courses'),
    ('jp', 'friends', 5, '🤩', 'Friends',  '交際',         'Amis'),
    ('jp', 'leisure', 6, '🏔️', 'Leisure',  'レジャー',     'Loisirs'),
    ('jp', 'medical', 7, '💊', 'Medical',  '医療',         'Santé'),
    ('jp', 'beauty',  8, '🧴', 'Beauty',   '美容',         'Beauté'),
    ('jp', 'fashion', 9, '👘', 'Fashion',  'ファッション', 'Mode'),

    ('eu', 'eat_out',   1, '🍔', 'Eat Out',   '外食',         'Restaurant'),
    ('eu', 'bakery',    2, '🥖', 'Bakery',    'パン屋',       'Boulangerie'),
    ('eu', 'grocery',   3, '🛒', 'Grocery',   '食料品',       'Courses'),
    ('eu', 'transport', 4, '🚌', 'Transport', '交通',         'Transports'),
    ('eu', 'friends',   5, '🤩', 'Friends',   '交際',         'Amis'),
    ('eu', 'leisure',   6, '🏔️', 'Leisure',   'レジャー',     'Loisirs'),
    ('eu', 'pharmacy',  7, '💊', 'Pharmacy',  '薬局',         'Pharmacie'),
    ('eu', 'beauty',    8, '🧴', 'Beauty',    '美容',         'Beauté'),
    ('eu', 'fashion',   9, '👕', 'Fashion',   'ファッション', 'Mode'),

    ('us', 'eat_out',  1,  '🍔', 'Eat Out',  '外食',         'Restaurant'),
    ('us', 'coffee',   2,  '☕', 'Coffee',   'コーヒー',     'Café'),
    ('us', 'grocery',  3,  '🛒', 'Grocery',  '食料品',       'Courses'),
    ('us', 'gas',      4,  '⛽', 'Gas',      'ガソリン',     'Essence'),
    ('us', 'transit',  5,  '🚌', 'Transit',  '公共交通',     'Transports en commun'),
    ('us', 'friends',  6,  '🤩', 'Friends',  '交際',         'Amis'),
    ('us', 'leisure',  7,  '🏔️', 'Leisure',  'レジャー',     'Loisirs'),
    ('us', 'medical',  8,  '💊', 'Medical',  '医療',         'Santé'),
    ('us', 'beauty',   9,  '🧴', 'Beauty',   '美容',         'Beauté'),
    ('us', 'fashion',  10, '👕', 'Fashion',  'ファッション', 'Mode');

COMMIT;
