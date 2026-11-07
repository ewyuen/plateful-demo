from django.db import migrations


def create_group(apps, schema_editor):
    # The owner role (ADR-0020), created here so every database has it. No user is changed.
    Group = apps.get_model("auth", "Group")
    Group.objects.get_or_create(name="owner")


def remove_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name="owner").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0001_initial"),
        ("cafe", "0011_customer_group"),
    ]

    operations = [migrations.RunPython(create_group, remove_group)]
