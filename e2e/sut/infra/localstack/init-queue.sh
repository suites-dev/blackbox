#!/bin/sh
set -eu

awslocal sqs create-queue --queue-name subscription-orders >/dev/null
