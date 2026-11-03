from django.db import migrations

GROUPS = ("fulfilment", "admin")


def create_groups(apps, schema_editor):
    # The two staff roles (ADR-0014). Created here so every database has them.
    Group = apps.get_model("auth", "Group")
    for name in GROUPS:
        Group.objects.get_or_create(name=name)


def remove_groups(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name__in=GROUPS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0001_initial"),
        ("cafe", "0007_restaurant_staff"),
    ]

    operations = [migrations.RunPython(create_groups, remove_groups)]
