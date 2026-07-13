"""
SQLite schema and helpers.

Four tables mirror the objects a real routing stack operates on:
  leads             -> the inbound record being routed
  accounts          -> the book of business we match leads against
  reps              -> the sales roster and its capacity
  routing_decisions -> the audit log: one row per lead, recording what fired

routing_decisions is the important one. Every decision records which rule
fired and why, so the whole system is inspectable after the fact. That audit
trail is the difference between a routing rule you can defend to Sales and a
black box.
"""

import os
import sqlite3

import config


def connect():
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn):
    conn.executescript(
        """
        DROP TABLE IF EXISTS routing_decisions;
        DROP TABLE IF EXISTS leads;
        DROP TABLE IF EXISTS accounts;
        DROP TABLE IF EXISTS reps;

        CREATE TABLE reps (
            rep_id       TEXT PRIMARY KEY,
            name         TEXT,
            segment      TEXT,
            region       TEXT,
            timezone     TEXT,
            capacity     INTEGER,
            is_ramping   INTEGER,
            seniority    TEXT
        );

        CREATE TABLE accounts (
            account_id      TEXT PRIMARY KEY,
            account_name    TEXT,
            name_normalized TEXT,
            domain          TEXT,
            region          TEXT,
            state           TEXT,
            segment         TEXT,
            is_customer     INTEGER,
            has_open_opp    INTEGER,
            owner_rep_id    TEXT,
            last_activity_days INTEGER      -- days since owner last touched it
        );

        CREATE TABLE leads (
            lead_id           TEXT PRIMARY KEY,
            created_offset_min INTEGER,     -- minutes since the run's t0
            first_name        TEXT,
            last_name         TEXT,
            email             TEXT,
            email_domain      TEXT,
            is_personal_email INTEGER,
            company_name      TEXT,
            company_normalized TEXT,
            domain            TEXT,
            phone             TEXT,
            country           TEXT,
            state             TEXT,
            region            TEXT,
            timezone          TEXT,
            num_locations     INTEGER,
            student_count     INTEGER,
            industry          TEXT,
            job_title         TEXT,
            seniority         TEXT,
            lead_source       TEXT,
            channel           TEXT,          -- inbound / outbound
            utm_campaign      TEXT,
            pages_viewed      INTEGER,
            trial_started     INTEGER,
            days_since_touch  INTEGER
        );

        CREATE TABLE routing_decisions (
            lead_id            TEXT PRIMARY KEY,
            matched_account_id TEXT,
            match_method       TEXT,        -- domain / name_exact / name_fuzzy / none
            match_confidence   REAL,
            score              INTEGER,
            score_band         TEXT,
            segment            TEXT,
            region             TEXT,
            rule_fired         TEXT,        -- which routing rule decided this
            assigned_rep_id    TEXT,
            status             TEXT,         -- routed / nurture / unrouted
            reason             TEXT,        -- human-readable explanation
            time_in_queue_min  REAL,
            manual_override    INTEGER,
            FOREIGN KEY (lead_id) REFERENCES leads(lead_id)
        );
        """
    )
    conn.commit()


def load_reps(conn):
    conn.executemany(
        "INSERT INTO reps VALUES (?,?,?,?,?,?,?,?)",
        [
            (r[0], r[1], r[2], r[3], r[4], r[5], int(r[6]), r[7])
            for r in config.REPS
        ],
    )
    conn.commit()
