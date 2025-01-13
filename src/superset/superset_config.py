# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#
# This file is included in the final Docker image and SHOULD be overridden when
# deploying the image to prod. Settings configured here are intended for use in local
# development environments. Also note that superset_config_docker.py is imported
# as a final step as a means to override "defaults" configured here
#
import logging
import os

from celery.schedules import crontab
from flask_caching.backends.rediscache import RedisCache
from ssl import CERT_OPTIONAL

logger = logging.getLogger()

DATABASE_DIALECT = os.getenv("DATABASE_DIALECT")
DATABASE_USER = os.getenv("DATABASE_USER")
DATABASE_PASSWORD = os.getenv("DATABASE_PASSWORD")
DATABASE_HOST = os.getenv("DATABASE_HOST")
DATABASE_PORT = os.getenv("DATABASE_PORT")
DATABASE_DB = os.getenv("DATABASE_DB")

EXAMPLES_USER = os.getenv("EXAMPLES_USER")
EXAMPLES_PASSWORD = os.getenv("EXAMPLES_PASSWORD")
EXAMPLES_HOST = os.getenv("EXAMPLES_HOST")
EXAMPLES_PORT = os.getenv("EXAMPLES_PORT")
EXAMPLES_DB = os.getenv("EXAMPLES_DB")
PUBLIC_URL = os.getenv("PUBLIC_URL")
SLACK_API_TOKEN = os.getenv("SLACK_API_TOKEN")

# The SQLAlchemy connection string.
SQLALCHEMY_DATABASE_URI = (
    f"{DATABASE_DIALECT}://"
    f"{DATABASE_USER}:{DATABASE_PASSWORD}@"
    f"{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_DB}"
)

SQLALCHEMY_EXAMPLES_URI = (
    f"{DATABASE_DIALECT}://"
    f"{EXAMPLES_USER}:{EXAMPLES_PASSWORD}@"
    f"{EXAMPLES_HOST}:{EXAMPLES_PORT}/{EXAMPLES_DB}"
)

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_CELERY_DB = os.getenv("REDIS_CELERY_DB", "0")
REDIS_RESULTS_DB = os.getenv("REDIS_RESULTS_DB", "1")

RESULTS_BACKEND = RedisCache(
    db=REDIS_RESULTS_DB,
    host=REDIS_HOST,
    key_prefix="superset_results_",
    port=REDIS_PORT,
    ssl=False,
    ssl_cert_reqs=CERT_OPTIONAL,
)


CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": REDIS_RESULTS_DB,
}
DATA_CACHE_CONFIG = CACHE_CONFIG


class CeleryConfig:
    broker_url = f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_CELERY_DB}"
    imports = (
        "superset.sql_lab",
        "superset.tasks.scheduler",
        "superset.tasks.thumbnails",
        "superset.tasks.cache",
    )
    result_backend = f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_RESULTS_DB}"
    worker_prefetch_multiplier = 1
    task_acks_late = False
    beat_schedule = {
        "reports.scheduler": {
            "task": "reports.scheduler",
            "schedule": crontab(minute="*", hour="*"),
        },
        "reports.prune_log": {
            "task": "reports.prune_log",
            "schedule": crontab(minute=10, hour=0),
        },
    }


CELERY_CONFIG = CeleryConfig

# ---------------------------------------------------
# Feature flags
# ---------------------------------------------------
# Feature flags that are set by default go here. Their values can be
# overwritten by those specified under FEATURE_FLAGS in superset_config.py
# For example, DEFAULT_FEATURE_FLAGS = { 'FOO': True, 'BAR': False } here
# and FEATURE_FLAGS = { 'BAR': True, 'BAZ': True } in superset_config.py
# will result in combined feature flags of { 'FOO': True, 'BAR': True, 'BAZ': True }
# Check the documentation for more details on feature flags
# https://github.com/apache/superset/blob/master/RESOURCES/FEATURE_FLAGS.md

FEATURE_FLAGS: dict[str, bool] = {
    # When this feature is enabled, nested types in Presto will be
    # expanded into extra columns and/or arrays. This is experimental,
    # and doesn't work with all nested types.
    "PRESTO_EXPAND_DATA": False,
    # Exposes API endpoint to compute thumbnails
    "THUMBNAILS": False,
    "SHARE_QUERIES_VIA_KV_STORE": False,
    "TAGGING_SYSTEM": False,
    "SQLLAB_BACKEND_PERSISTENCE": True,
    "LISTVIEWS_DEFAULT_CARD_VIEW": False,
    # When True, this escapes HTML (rather than rendering it) in Markdown components
    "ESCAPE_MARKDOWN_HTML": False,
    "DASHBOARD_VIRTUALIZATION": True,
    "GLOBAL_ASYNC_QUERIES": False,
    "EMBEDDED_SUPERSET": False,
    # Enables Alerts and reports new implementation
    "ALERT_REPORTS": True,
    "DASHBOARD_RBAC": False, 
    "ENABLE_ADVANCED_DATA_TYPES": False,
    # Enabling ALERTS_ATTACH_REPORTS, the system sends email and slack message
    # with screenshot and link
    # Disables ALERTS_ATTACH_REPORTS, the system DOES NOT generate screenshot
    # for report with type 'alert' and sends email and slack message with only link;
    # for report with type 'report' still send with email and slack message with
    # screenshot and link
    "ALERTS_ATTACH_REPORTS": True,
    # Allow users to export full CSV of table viz type.
    # This could cause the server to run out of memory or compute.
    "ALLOW_FULL_CSV_EXPORT": False,
    "ALLOW_ADHOC_SUBQUERY": False,
    # Apply RLS rules to SQL Lab queries. This requires parsing and manipulating the
    # query, and might break queries and/or allow users to bypass RLS. Use with care!
    "RLS_IN_SQLLAB": False,
    # Enable caching per impersonation key (e.g username) in a datasource where user
    # impersonation is enabled
    "CACHE_IMPERSONATION": False,
    # Enable sharing charts with embedding
    "EMBEDDABLE_CHARTS": True,
    "DRILL_BY": False,
    "DATAPANEL_CLOSED_BY_DEFAULT": False,
    "HORIZONTAL_FILTER_BAR": False,
    # The feature is off by default, and currently only supported in Presto and Postgres,  # noqa: E501
    # and Bigquery.
    # It also needs to be enabled on a per-database basis, by adding the key/value pair
    # `cost_estimate_enabled: true` to the database `extra` attribute.
    "ESTIMATE_QUERY_COST": False,
    # Allow users to enable ssh tunneling when creating a DB.
    # Users must check whether the DB engine supports SSH Tunnels
    # otherwise enabling this flag won't have any effect on the DB.
    "SSH_TUNNELING": False,
    # Allows users to add a ``superset://`` DB that can query across databases. This is
    # an experimental feature with potential security and performance risks, so use with
    # caution. If the feature is enabled you can also set a limit for how much data is
    # returned from each database in the ``SUPERSET_META_DB_LIMIT`` configuration value
    # in this file.
    # https://superset.apache.org/docs/configuration/databases/#enabling-the-meta-database
    "ENABLE_SUPERSET_META_DB": False,
    # Set to True to replace Selenium with Playwright to execute reports and thumbnails.
    # Unlike Selenium, Playwright reports support deck.gl visualizations
    # Enabling this feature flag requires installing "playwright" pip package
    "PLAYWRIGHT_REPORTS_AND_THUMBNAILS": False,
    # Set to True to enable Jinja templating in queries in SQL Lab and Explore
    "ENABLE_TEMPLATE_PROCESSING": True,
}

#########################
# Notification Settings #
########################
# smtp server configuration
EMAIL_NOTIFICATIONS = True  # all the emails are sent using dryrun
# Screenshots will be taken but no messages actually sent as long as this is True
ALERT_REPORTS_NOTIFICATION_DRY_RUN = True
SMTP_HOST = "email-smtp.eu-central-1.amazonaws.com"
SMTP_STARTTLS = True
SMTP_SSL = False
SMTP_PORT = 587
SMTP_MAIL_FROM = "supserset@legitimatedomain.com"
SMTP_USER = "your_user" # use the empty string "" if using an unauthenticated SMTP server
SMTP_PASSWORD = "your_password" # use the empty string "" if using an unauthenticated SMTP server
MTP_MAIL_FROM = "noreply@youremail.com"
EMAIL_REPORTS_SUBJECT_PREFIX = "[Superset] " # optional - overwrites default value in config.py of "[Report] "
# If True creates a default SSL context with ssl.Purpose.CLIENT_AUTH using the
# default system root CA certificates.
SMTP_SSL_SERVER_AUTH = False
ENABLE_CHUNK_ENCODING = False

WEBDRIVER_BASEURL = PUBLIC_URL
# The base URL for the email report hyperlinks.
WEBDRIVER_BASEURL_USER_FRIENDLY = WEBDRIVER_BASEURL
# If the load balancer is inserting X-Forwarded-For/X-Forwarded-Proto headers
# you should set this to True 
ENABLE_PROXY_FIX = True
# Allows SQL Lab to run queries without a row limit when using the CTAS feature.
SQLLAB_CTAS_NO_LIMIT = True

#
# Optionally import superset_config_docker.py (which will have been included on
# the PYTHONPATH) in order to allow for local settings to be overridden
#
try:
    import superset_config_docker
    from superset_config_docker import *  # noqa

    logger.info(
        f"Loaded your Docker configuration at " f"[{superset_config_docker.__file__}]"
    )
except ImportError:
    logger.info("Using default Docker config...")
