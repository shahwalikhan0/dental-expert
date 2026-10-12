-- The register's third mark is Late, not Leave: L was always meant as "came in,
-- but not on time". Renamed in place so any day already marked L keeps its
-- mark and simply reads as Late.
ALTER TYPE "AttendanceStatus" RENAME VALUE 'LEAVE' TO 'LATE';
