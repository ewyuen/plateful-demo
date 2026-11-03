from django.db import migrations


def create_group(apps, schema_editor):
    # The customer role (ADR-0014), created here so every database has it.
    Group = apps.get_model("auth", "Group")
    Group.objects.get_or_create(name="customer")


def remove_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name="customer").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0001_initial"),
        ("cafe", "0010_order_customer"),
    ]

    operations = [migrations.RunPython(create_group, remove_group)]
