-- Marketplace (D22-D24): a facility is now a host's listed parking space.

-- The host who listed the space; NULL = managed by the platform admin (the original facility).
ALTER TABLE facilities ADD COLUMN owner_id INT REFERENCES users(id) ON DELETE RESTRICT;
-- Where the space is, for search. The house address stays in `address` and is not shown in search.
ALTER TABLE facilities ADD COLUMN locality TEXT;
ALTER TABLE facilities ADD COLUMN city TEXT NOT NULL DEFAULT 'New Delhi';
-- A host can take a space off the search results without deleting it.
ALTER TABLE facilities ADD COLUMN is_listed BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE facilities ADD CONSTRAINT facilities_locality_length
  CHECK (locality IS NULL OR char_length(locality) BETWEEN 1 AND 100);
ALTER TABLE facilities ADD CONSTRAINT facilities_city_length
  CHECK (char_length(city) BETWEEN 1 AND 100);

CREATE INDEX facilities_owner_idx ON facilities (owner_id);
CREATE INDEX facilities_locality_idx ON facilities (lower(locality));

UPDATE facilities SET locality = 'Lajpat Nagar' WHERE locality IS NULL;
