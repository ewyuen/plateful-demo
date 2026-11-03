from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from cafe.models import CheckoutDraft


class Command(BaseCommand):
    help = (
        "Delete checkout drafts older than a given age. A draft is left behind when a "
        "customer starts paying and never finishes; orders are never touched."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than-hours",
            type=float,
            default=24,
            help="Delete drafts created more than this many hours ago (default 24).",
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(hours=options["older_than_hours"])
        # The items go with the draft (CASCADE); the Order table is not involved.
        deleted, _ = CheckoutDraft.objects.filter(created_at__lt=cutoff).delete()
        drafts = CheckoutDraft.objects.count()
        self.stdout.write(f"Deleted {deleted} rows of old checkout drafts; {drafts} drafts remain.")
