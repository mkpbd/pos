-- One-time local PostgreSQL bootstrap for Enterprise POS.
--
-- Creates the least-privilege application role and the app + test databases.
-- Run as a PostgreSQL superuser (psql asks for that password itself):
--
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f database\scripts\create_local_databases.sql
--
-- You will be prompted for the password to give the new "pos_app" role.
-- Put that same value in backend/.env as DB_PASSWORD. Safe to re-run.

\set ON_ERROR_STOP on

\if :{?app_password}
\else
  \prompt 'Password for new role pos_app: ' app_password
\endif

SELECT format('CREATE ROLE pos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app')
\gexec

SELECT 'CREATE DATABASE pos OWNER pos_app ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pos')
\gexec

SELECT 'CREATE DATABASE pos_test OWNER pos_app ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pos_test')
\gexec

\echo 'Done: role pos_app, databases pos and pos_test.'
